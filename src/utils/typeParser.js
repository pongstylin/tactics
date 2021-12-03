class ParseError extends Error {
  constructor(message, columnNumber) {
    super(message);
    this.columnNumber = columnNumber;
  }
}

const getTokenMap = new Map([
  [ ' ', getSpaceToken  ],
  [ '(', getListToken   ],
  [ '[', getListToken   ],
  [ '{', getObjectToken ],
  [ "'", getStringToken ],
  [ '"', getStringToken ],
  [ '`', getStringToken ],
  [ '/', getRegexToken  ],
]);

const tokenTypeMap = new Map([
  [ ':', 'colon' ],
  [ '|', 'pipe'  ],
  [ ',', 'comma' ],
  [ '(', 'list' ],
  [ ')', 'list-end' ],
  [ '[', 'array' ],
  [ ']', 'array-end' ],
  [ '{', 'object' ],
  [ '}', 'object-end' ],
]);
const endTokenTypeMap = new Map([
  [ '(', 'list-end' ],
  [ '[', 'array-end' ],
  [ '{', 'object-end' ],
]);
for (const chr of tokenTypeMap.keys()) {
  if (!getTokenMap.has(chr))
    getTokenMap.set(chr, getCharToken);
}

const digits = '0123456789';
const lettersLC = 'abcdefghijklmnopqrstuvwxyz';
const lettersUC = lettersLC.toUpperCase();

const numberChars = `-${digits}`;
for (const chr of numberChars) {
  getTokenMap.set(chr, getNumberToken);
}

const varNameStartChars = `${lettersLC}${lettersUC}_$`;
const varNameChars = new Set([ ...digits, ...varNameStartChars ]);
for (const chr of varNameStartChars) {
  getTokenMap.set(chr, getVarToken);
}

function getNextToken(str, len, startIndex) {
  for (let i = startIndex; i < len; i++) {
    const getToken = getTokenMap.get(str[i]);
    if (typeof getToken !== 'function')
      throw new ParseError(`Unexpected character '${str[i]}'`, i);

    const token = getToken(str, len, i);
    if (token.type === 'space') {
      i = token.endIndex;
      continue;
    }

    return token;
  }

  return { type:'end', startIndex, endIndex:len };
}
function getSpaceToken(str, len, startIndex) {
  for (let i = startIndex + 1; i < len; i++) {
    switch (str[i]) {
      case ' ':
        continue;
      default:
        return { type:'space', startIndex, endIndex:i - 1 };
    }
  }

  return { type:'space', startIndex, endIndex:len - 1 };
}
function getListToken(str, len, startIndex) {
  const tokenType = tokenTypeMap.get(str[startIndex]);
  const endTokenType = endTokenTypeMap.get(str[startIndex]);
  const subTokens = [];

  let nextToken = getNextToken(str, len, startIndex + 1);
  if (nextToken.type === endTokenType)
    return { type:tokenType, tokens:subTokens, startIndex, endIndex:nextToken.endIndex };

  while (nextToken.type !== 'end') {
    if (nextToken.type === 'comma') {
      subTokens.push({ type:'undefined' });
      nextToken = getNextToken(str, len, nextToken.endIndex + 1);
    } else {
      subTokens.push(nextToken);
      nextToken = getNextToken(str, len, nextToken.endIndex + 1);
      if (nextToken.type === 'comma')
        nextToken = getNextToken(str, len, nextToken.endIndex + 1);
      else if (nextToken.type === endTokenType)
        return { type:tokenType, tokens:subTokens, startIndex, endIndex:nextToken.endIndex };
      else if (nextToken.type !== 'end')
        throw new ParseError(`Unexpected ${tokenType} token '${nextToken.type}'`, nextToken.startIndex);
    }
  }

  throw new ParseError(`Hit end of input while processing ${tokenType}`, startIndex);
}
function getObjectToken(str, len, startIndex) {
  const tokenType = 'object';
  const endTokenType = 'object-end';
  const subTokens = [];

  let nextToken = getNextToken(str, len, startIndex + 1);
  if (nextToken.type === endTokenType)
    return { type:tokenType, tokens:subTokens, startIndex, endIndex:nextToken.endIndex };

  while (nextToken.type !== 'end') {
    const keyToken = nextToken;
    if (keyToken.type !== 'var' && keyToken.type !== 'string')
      throw new ParseError('Expected key token', keyToken.startIndex);

    const colonToken = getNextToken(str, len, keyToken.endIndex + 1);
    if (colonToken.type !== 'colon')
      throw new ParseError('Expected colon token', colonToken.startIndex);

    const valueToken = getNextToken(str, len, colonToken.endIndex + 1);
    subTokens.push({ type:'property', keyToken, valueToken });

    nextToken = getNextToken(str, len, valueToken.endIndex + 1);
    if (nextToken.type === 'comma')
      nextToken = getNextToken(str, len, nextToken.endIndex + 1);
    else if (nextToken.type === endTokenType)
      return { type:tokenType, tokens:subTokens, startIndex, endIndex:nextToken.endIndex };
    else if (nextToken.type !== 'end')
      throw new ParseError(`Unexpected ${tokenType} token '${nextToken.type}'`, nextToken.startIndex);
  }

  throw new ParseError(`Hit end of input while processing object`, startIndex);
}
function getStringToken(str, len, startIndex) {
  const endChar = str[startIndex];

  for (let i = startIndex + 1; i < len; i++) {
    switch (str[i]) {
      case endChar:
        return { type:'string', startIndex, endIndex:i };
      case '\\':
        i++;
    }
  }

  throw new ParseError(`Hit end of input while processing string`, startIndex);
}
function getRegexToken(str, len, startIndex) {
  const endChar = str[startIndex];

  for (let i = startIndex + 1; i < len; i++) {
    switch (str[i]) {
      case endChar:
        // Includes trailing flags
        for (let j = i + 1; j < len; j++) {
          if (!lettersLC.includes(str[j]))
            return { type:'regex', startIndex, endIndex:j - 1 };
        }

        return { type:'regex', startIndex, endIndex:len - 1 };
      case '\\':
        i++;
    }
  }

  throw new ParseError(`Hit end of input while processing string`, startIndex);
}
function getNumberToken(str, len, startIndex) {
  let foundDecimal = false;

  for (let i = startIndex + 1; i < len; i++) {
    const chr = str[i];
    if (chr === '.') {
      if (foundDecimal)
        throw new ParseError('Unexpected decimal', i);
      foundDecimal = true;
    } else if (!digits.includes(chr))
      return { type:'number', startIndex, endIndex:i - 1 };
  }

  return { type:'number', startIndex, endIndex:len - 1 };
};
function getVarToken(str, len, startIndex) {
  for (let i = startIndex + 1; i < len; i++) {
    if (!varNameChars.has(str[i]))
      return { type:'var', startIndex, endIndex:i - 1 };
  }

  return { type:'var', startIndex, endIndex:len - 1 };
}
function getCharToken(str, len, startIndex) {
  const tokenType = tokenTypeMap.get(str[startIndex]);
  if (tokenType === undefined)
    throw new ParseError('Unsupported character token', startIndex);

  return { type:tokenType, startIndex, endIndex:startIndex };
}

export default str => {
  const len = str.length;
  const types = [];

  try {
    let nextToken = getNextToken(str, len, 0);
    let cursor = nextToken.endIndex + 1;
    while (nextToken.type !== 'end') {
      if (nextToken.type !== 'var')
        throw new ParseError('Expected type token', nextToken.startIndex);

      const type = {
        name: str.slice(nextToken.startIndex, cursor),
      };
      types.push(type);

      if (str[cursor] === ':') {
        nextToken = getNextToken(str, len, cursor + 1);
        cursor = nextToken.endIndex + 1;
        if (nextToken.type !== 'var')
          throw new ParseError('Expected type token', nextToken.startIndex);

        type.name += ':' + str.slice(nextToken.startIndex, cursor);
      }
      if (str[cursor] === '(') {
        nextToken = getNextToken(str, len, cursor);
        cursor = nextToken.endIndex + 1;
        type.params = str.slice(nextToken.startIndex + 1, nextToken.endIndex);
      }
      if (str[cursor] === '[') {
        nextToken = getNextToken(str, len, cursor);
        cursor = nextToken.endIndex + 1;
        type.arrayParams = str.slice(nextToken.startIndex + 1, nextToken.endIndex);
      }

      nextToken = getNextToken(str, len, cursor);
      cursor = nextToken.endIndex + 1;
      if (nextToken.type === 'end')
        break;
      else if (nextToken.type === 'pipe') {
        nextToken = getNextToken(str, len, cursor);
        cursor = nextToken.endIndex + 1;
      } else
        throw new ParseError(`Unexpected type token '${nextToken.type}'`, nextToken.startIndex);
    }
  } catch(e) {
    if (e instanceof ParseError) {
      const snippet = str.slice(0, e.columnNumber) + '<--HERE-->' + str.slice(e.columnNumber);
      throw new Error(`${e.message}: ${snippet}`, { cause:e });
    }

    throw e;
  }

  return types;
};
