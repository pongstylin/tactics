/**
 * Creates a function that guarantees sequential execution of an async function.
 * @param {Function} fn The async function to be executed sequentially.
 * @returns {Function} A new function that wraps fn and executes it sequentially.
 */
export default (fn) => {
  let queue = Promise.resolve();

  return (...args) => {
    const promise = queue.then(() => fn(...args));
    queue = promise.catch(() => {});
    return promise;
  };
};