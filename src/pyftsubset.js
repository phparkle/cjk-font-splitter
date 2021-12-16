import child_process from 'child_process'
import { promisify } from 'util'

const execFile = promisify(child_process.execFile)

const pyftsubset = async ({
  inputFile,
  outputFile,
  unicodes,
  flavor,
}) => {
  console.log(`Generating subset: ${outputFile}`)
  await execFile('pyftsubset', [
    inputFile,
    `--output-file=${outputFile}`,
    `--unicodes=${unicodes}`,
    `--flavor=${flavor}`,
  ])
}

export default pyftsubset
