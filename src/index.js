import { join } from 'path'
import { promisify } from 'util'

import async from 'async'
import * as csstree from 'css-tree'
import fontkit from 'fontkit'
import fs from 'fs-extra'
import mkdirp from 'mkdirp'
import Piscina from 'piscina'
import prettier from 'prettier'
import cachios from 'cachios'
import LRU from 'lru-cache'

/**
 * Piscina worker thread pool
 */
const piscina = new Piscina({
  filename: new URL('./pyftsubset.js', import.meta.url).href,
})

/**
 * Configure cachios
 */
cachios.cache = new LRU(256)

/**
 * Supported locales. Keys must be valid Noto font suffixes
 */
const validLocales = {
  sc: 'Simplified Chinese',
  tc: 'Traditional Chinese',
  hk: 'Hong Kong',
  jp: 'Japanese',
  kr: 'Korean',
}

/**
 * Supported font-weight values
 */
const validFontWeights = {
  100: 'Thin',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  700: 'Bold',
  900: 'Black',
}

/**
 * Supported font-display values
 */
const validFontDisplays = {
  auto: 'auto',
  block: 'block',
  swap: 'swap',
  fallback: 'fallback',
  optional: 'optional',
}

/**
 * Supported formats
 */
const validFormats = {
  woff2: 'woff2',
  woff: 'woff',
}

/**
 * Default options
 */
const defaultOptions = {
  fontDisplay: 'swap',
  fontFamily: null,
  fontWeight: 400,
  formats: ['woff2', 'woff'],
  inputFontFilePath: null,
  locale: 'sc',
  outputPath: null,
  overwrite: true,
  srcPrefix: '../webfonts',
}

/**
 * Promisified functions
 */
const fontkitOpen = promisify(fontkit.open)

/**
 * Helper functions
 */
const validateOptions = async (options) => {
  if (!options.formats.every((format) => validFormats[format.toLowerCase()])) {
    throw new Error(`Invalid formats: ${options.formats.join(',')}`)
  }

  if (!validFontDisplays[options.fontDisplay.toLowerCase()]) {
    throw new Error(`Invalid font display: ${options.fontDisplay}`)
  }

  if (!validFontWeights[options.fontWeight]) {
    throw new Error(`Invalid font weight: ${options.fontWeight}`)
  }

  if (!validLocales[options.locale.toLowerCase()]) {
    throw new Error(`Invalid locale: ${options.locale}`)
  }

  if (!(await fs.pathExists(options.inputFontFilePath))) {
    throw new Error(`Invalid font file path: ${options.inputFontFilePath}`)
  }

  if (!options.outputPath) {
    throw new Error(`Invalid output path: ${options.outputPath}`)
  }

  return options
}

/**
 * Main function
 */
const CJKFontSplitter = async (options) => {
  const {
    fontDisplay,
    fontFamily,
    fontWeight,
    formats,
    inputFontFilePath,
    locale,
    outputPath,
    overwrite,
    srcPrefix,
  } = await validateOptions({ ...defaultOptions, ...options })

  // Open font file
  console.log(`Opening font file: ${inputFontFilePath}`)
  const inputFont = await fontkitOpen(inputFontFilePath)

  // Create output dirs
  const outputDirPath = join(outputPath, inputFont.postscriptName)

  const cssDirPath = join(outputDirPath, 'css')
  console.log(`Creating output directory: ${cssDirPath}`)
  await mkdirp(cssDirPath)

  const webfontsDirPath = join(outputDirPath, 'webfonts')
  console.log(`Creating output directory: ${webfontsDirPath}`)
  await mkdirp(webfontsDirPath)

  // Download google fonts css
  const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+${locale.toUpperCase()}:wght@${fontWeight}&display=${fontDisplay.toLowerCase()}`
  console.log(`Downloading CSS from Google Fonts: ${url}`)
  const { data: inputCss } = await cachios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:95.0) Gecko/20100101 Firefox/95.0',
    },
    ttl: 24 * 60 * 60,
  })

  // Parse css
  console.log('Parsing css...')
  const ast = csstree.parse(inputCss)

  // Process nodes
  const fontFaces = csstree.findAll(ast, (node) => node.type === 'Atrule' && node.name === 'font-face')

  await async.eachOf(fontFaces, async (fontFace, fontFaceIndex) => {
    // Set font-family
    const fontFamilyNode = csstree.find(fontFace, (node) => node.type === 'Declaration' && node.property === 'font-family')
    csstree.find(fontFamilyNode, (node) => node.type === 'String').value = fontFamily || inputFont.familyName

    // Get unicode ranges
    const unicodeRangeNode = csstree.find(fontFace, (node) => node.type === 'Declaration' && node.property === 'unicode-range')
    const unicodeRanges = csstree.findAll(unicodeRangeNode, (node) => node.type === 'UnicodeRange').map((node) => node.value).join(',')

    // Clear src value
    const srcList = csstree.find(fontFace, (node) => node.type === 'Declaration' && node.property === 'src').value.children
    srcList.clear()

    // Output font files
    await async.eachOfSeries(formats, async (format, formatIndex) => {
      const outputFontFileName = `${inputFont.postscriptName}_${fontFaceIndex}.${format}`

      if (formatIndex > 0) {
        srcList.push({ type: 'Operator', value: ',' })
        srcList.push({ type: 'WhiteSpace', value: ' ' })
      }
      srcList.push({ type: 'Url', value: join(srcPrefix, outputFontFileName) })
      srcList.push({ type: 'WhiteSpace', value: ' ' })
      srcList.push(csstree.fromPlainObject({ type: 'Function', name: 'format', children: [{ type: 'String', value: format.toLowerCase() }] }))

      const outputFontFilePath = join(webfontsDirPath, outputFontFileName)

      if (overwrite || !(await fs.pathExists(outputFontFilePath))) {
        await piscina.run({
          inputFile: inputFontFilePath,
          outputFile: outputFontFilePath,
          unicodes: unicodeRanges,
          flavor: format.toLowerCase(),
        })
      } else {
        // console.log(`File exists: ${outputFontFilePath}`)
      }
    })
  })

  // Output css file
  const outputCss = prettier.format(csstree.generate(ast), { parser: 'css', printWidth: Infinity })
  const outputCssFileName = `${inputFont.postscriptName}.css`
  const outputCssFilePath = join(cssDirPath, outputCssFileName)
  console.log(`Writing css file: ${outputCssFilePath}`)
  await fs.writeFile(outputCssFilePath, outputCss)
}

/**
 * Module exports
 */
export default CJKFontSplitter
