const reMatcher = /[-[\]{}()*+!<=:?.\/\\^$|#\s,]/g;

if (!RegExp.escape)
  Object.defineProperty(RegExp, 'escape', {
    value: str => str.replace(reMatcher, '\\$&')
  });
