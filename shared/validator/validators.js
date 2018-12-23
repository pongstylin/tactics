const cleanValue = value => String(value).trim();

module.exports = {
  required: field => ({
    passed: field.value && cleanValue(field.value).length > 0,
    message: `${field.name} is required`,
  }),
  min: number => field => ({
    passed: cleanValue(field.value).length >= Number(number),
    message: `${field.name} needs to be ${Number(number)} or more`,
  }),
  max: number => field => ({
    passed: cleanValue(field.value).length <= Number(number),
    message: `${field.name} needs to be ${Number(number)} or less`,
  }),
  matches: valueToCompare => field => ({
    passed: cleanValue(valueToCompare) === cleanValue(field.value),
    message: `${field.name}s don't match`,
  }),
}
