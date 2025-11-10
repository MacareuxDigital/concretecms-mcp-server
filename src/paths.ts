import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const PROJECT_ROOT = join(__dirname, '..')
export const TOKEN_FILE = join(PROJECT_ROOT, '.tokens.json')
export const OPENAPI_SPEC_FILE = join(PROJECT_ROOT, 'openapi.yml')
