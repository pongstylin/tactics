let whenDOMReady;

if (document.readyState !== 'loading')
  whenDOMReady = Promise.resolve();
else
  whenDOMReady = new Promise(resolve => {
    let listener = event => {
      document.removeEventListener('readystatechange', listener);
      resolve();
    };

    document.addEventListener('readystatechange', listener);
  });

export default whenDOMReady;
