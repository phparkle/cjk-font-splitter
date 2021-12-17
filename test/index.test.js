import CJKFontSplitter from '../src/index.js'

const zipFilePath = await CJKFontSplitter({
  inputFontFilePath: 'data/input/XiaolaiSC-Regular.ttf',
  outputPath: 'data/output',
  formats: ['woff2', 'woff'],
  overwrite: false,
})

console.log(zipFilePath)
