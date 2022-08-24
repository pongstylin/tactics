import config from 'config/server.js';

/*
 * NodeJS doesn't do a very good job of locating the source of syntax errors for
 * dynamic imports.  This helps a little, but isn't a perfect solution.
 */
const importModule = path => import(path).catch(error => {
  if (!(error instanceof SyntaxError)) throw error;

  if (error.fileName === undefined)
    error.fileName = `src/${path}`;
  if (error.lineNumber === undefined)
    error.lineNumber = '?';
  if (error.columnNumber === undefined)
    error.columnNumber = '?';
  if (!error.stack.includes(import.meta.url))
    error.stack = [
      `${error.name}: ${error.message}`,
      `    [For more details try: npm run script ${error.fileName}]`,
      `    at dynamic import (${error.fileName}:${error.lineNumber}:${error.columnNumber})`,
      ...new Error().stack.split('\n').slice(2),
    ].join('\n');

  throw error;
});

const services = new Map();
const servicesReady = Promise.all(
  [...config.services].map(async ([serviceName, serviceInfo]) => {
    const serviceModuleName = serviceName.toUpperCase('first');
    const Service = (await importModule(serviceInfo.module)).default;
    const DataAdapter = (await importModule(serviceInfo.dataAdapterModule)).default;

    services.set(serviceName, new Service({
      name: serviceName,
      data: await new DataAdapter().bootstrap(),
      config: serviceInfo.config,
    }));
  }),
).then(() => {
  /*
   * Now that all services are instantiated, enable each service to access the others.
   */
  for (let serviceA of services.values()) {
    for (let [ serviceName, serviceB ] of services) {
      if (serviceA === serviceB) continue;

      serviceA[serviceName] = serviceB;
    }
  }
}).catch(error => {
  console.error(error);
  process.exit(1);
});

export default services;
export { servicesReady };
