import { handle } from './handler.js'

/**
 * Builds the Worker. Pass respond to answer some requests your own way during maintenance
 * (for example a JSON error for API clients); see handle in handler.js for how the functions are called.
 */
export const createWorker = ({ respond = [] } = {}) => {
  if (!Array.isArray(respond) || !respond.every((answer) => typeof answer === 'function')) {
    throw new TypeError('respond must be an array of functions')
  }
  return { fetch: (request, env) => handle(request, env, undefined, respond) }
}

export default createWorker()
