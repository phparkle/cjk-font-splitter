import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import CJKFontSubsetter from '../src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url));

CJKFontSubsetter({
  inputFontFilePath: resolve(__dirname, '../data/input/XiaolaiSC-Regular.ttf'),
  outputPath: resolve(__dirname, '../data/output'),
  formats: ['woff2'],
})
