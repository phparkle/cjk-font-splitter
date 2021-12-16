import CJKFontSplitter from '../src/index.js'

CJKFontSplitter({
  inputFontFilePath: 'data/input/XiaolaiSC-Regular.ttf',
  outputPath: 'data/output',
  formats: ['woff2', 'woff'],
  overwrite: false,
})
