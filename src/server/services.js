import config from '#config/server.js';
import pkg from '#package.json' with { type:'json' };

/*
 * NodeJS doesn't do a very good job of locating the source of syntax errors for
 * dynamic imports.  This helps a little, but isn't a perfect solution.
 */
const importModule = path => import(path).catch(error => {
  if (!(error instanceof SyntaxError)) throw error;

  if (error.fileName === undefined) {
    error.fileName = path;
    if (error.fileName.startsWith('#')) {
      for (const alias of Object.keys(pkg.imports)) {
        const match = alias.replace(/\*$/, '');
        if (path.startsWith(match)) {
          error.fileName = error.fileName.replace(match, pkg.imports[alias].replace(/\*$/, ''));
          break;
        }
      }
    }
  }
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
  for (const serviceA of services.values())
    for (const [ serviceName, serviceB ] of services)
      if (serviceA !== serviceB)
        serviceA[serviceName] = serviceB;

  /*
   * Now that all services are ready, initialize them.
   */
  for (const service of services.values())
    service.initialize();
}).catch(error => {
  console.error(error);
  process.exit(1);
});

export default services;
export { servicesReady };
