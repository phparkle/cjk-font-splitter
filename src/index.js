import child_process from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import mkdirp from 'mkdirp'
import async from 'async'
import os from 'os'

import axios from 'axios'
import * as csstree from 'css-tree'
import fontkit from 'fontkit'
import { access, writeFile } from 'fs/promises'
import prettier from 'prettier'

// Emulate Firefox user-agent header
axios.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:95.0) Gecko/20100101 Firefox/95.0'

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
  srcPrefix: '../webfonts',
}

/**
 * Main function
 */
async function CJKFontSubsetter(options) {
  // Merge default options
  options = Object.assign({}, defaultOptions, options)
  
  // Validate and unpack options
  const {
    fontDisplay,
    fontFamily,
    fontWeight,
    formats,
    inputFontFilePath,
    locale,
    outputPath,
    srcPrefix,
  } = await validateOptions(options)
  
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
  const url = googleFontsUrl(locale, fontWeight, fontDisplay)
  console.log(`Downloading CSS from Google Fonts: ${url}`)
  const { data: inputCss } = await axios.get(url)

  // Parse css
  console.log('Parsing css...')
  const ast = csstree.parse(inputCss)

  // Process nodes
  const fontFaces = csstree.findAll(ast, (node) => 'Atrule' === node.type && 'font-face' === node.name)

  console.log(`Number of cores: ${os.cpus().length}`)

  await async.eachOfLimit(fontFaces, os.cpus().length, async (fontFace, fontFaceIndex) => {
    // Set font-family
    const fontFamilyNode = csstree.find(fontFace, (node) => 'Declaration' === node.type && 'font-family' === node.property)
    csstree.find(fontFamilyNode, (node) => 'String' === node.type).value = fontFamily ? fontFamily : inputFont.familyName

    // Get unicode ranges
    const unicodeRangeNode = csstree.find(fontFace, (node) => 'Declaration' === node.type && 'unicode-range' === node.property)
    const unicodeRanges = csstree.findAll(unicodeRangeNode, (node) => 'UnicodeRange' === node.type).map((node) => node.value).join(',')

    // Clear src value
    const srcList = csstree.find(fontFace, (node) => 'Declaration' === node.type && 'src' === node.property).value.children
    srcList.clear()

    // Output font files
    for (const [formatIndex, format] of formats.entries()) {
      const outputFontFileName = `${inputFont.postscriptName}_${fontFaceIndex}.${format}`

      if (formatIndex > 0) {
        srcList.push({ type: 'Operator', value: ',' })
        srcList.push({ type: 'WhiteSpace', value: ' ' })
      }
      srcList.push({ type: 'Url', value: join(srcPrefix, outputFontFileName) })
      srcList.push({ type: 'WhiteSpace', value: ' ' })
      srcList.push(csstree.fromPlainObject({ type: 'Function', name: 'format', children: [ { type: 'String', value: format }] }))

      const outputFontFilePath = join(webfontsDirPath, outputFontFileName)

      try {
        await access(outputFontFilePath)
        console.log(`File exists: ${outputFontFilePath}`)
      } catch {
        console.log(`Generating subset: ${outputFontFilePath}`)
        await execFile('pyftsubset', [
          inputFontFilePath,
          `--output-file=${outputFontFilePath}`,
          `--unicodes=${unicodeRanges}`,
          `--flavor=${format}`
        ])
      }
    }
  })

  // Output css file
  const outputCss = prettier.format(csstree.generate(ast), { parser: 'css', printWidth: Infinity })
  const outputCssFileName = `${inputFont.postscriptName}.css`
  const outputCssFilePath = join(cssDirPath, outputCssFileName)
  await writeFile(outputCssFilePath, outputCss)

  return 0
}

async function validateOptions(options) {
  options.formats = options.formats.map((format) => format.toLowerCase())
  if (!options.formats.every((format) => validFormats[format]))
    throw `Invalid formats: ${options.formats.join(',')}`

  options.fontDisplay = options.fontDisplay.toLowerCase()
  if (!validFontDisplays[options.fontDisplay])
    throw `Invalid font display: ${options.fontDisplay}`

  if (!validFontWeights[options.fontWeight])
    throw `Invalid font weight: ${options.fontWeight}`

  options.locale = options.locale.toLowerCase()
  if (!validLocales[options.locale])
    throw `Invalid locale: ${options.locale}`  

  try {
    if (!options.inputFontFilePath)
      throw ''
    await access(options.inputFontFilePath)
  } catch {
    throw `Invalid font file path: ${options.inputFontFilePath}`
  }

  if (!options.outputPath)
    throw `Invalid output path: ${options.outputPath}`

  return options
}

/**
 * Promisified functions
 */
var fontkitOpen = promisify(fontkit.open)
var execFile = promisify(child_process.execFile)

/**
 * Generate Google Fonts URL
 */ 
function googleFontsUrl(locale, fontWeight, fontDisplay) {
  return `https://fonts.googleapis.com/css2?family=Noto+Sans+${locale.toUpperCase()}:wght@${fontWeight}&display=${fontDisplay}`
}  

/**
 * Module exports
 */
export default CJKFontSubsetter
