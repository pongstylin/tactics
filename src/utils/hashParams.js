export const getParam = (name) => {
  const paramsIndex = (() => {
    const index = location.hash.indexOf('?');
    return index > -1 ? index : location.hash.length;
  })();

  const params = new URLSearchParams(location.hash.slice(paramsIndex));
  return params.get(name);
}

export const setParam = (name, value) => {
  const paramsIndex = (() => {
    const index = location.hash.indexOf('?');
    return index > -1 ? index : location.hash.length;
  })();

  const params = new URLSearchParams(location.hash.slice(paramsIndex));
  params.set(name, value);
  history.replaceState(null, '', location.hash.slice(0, paramsIndex) + '?' + params);
};

export const unsetParam = name => {
  const paramsIndex = (() => {
    const index = location.hash.indexOf('?');
    return index > -1 ? index : location.hash.length;
  })();
  if (paramsIndex.length === 0) return;

  const params = new URLSearchParams(location.hash.slice(paramsIndex));
  params.delete(name);
  history.replaceState(null, '', location.hash.slice(0, paramsIndex) + '?' + params);
};