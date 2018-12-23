module.exports = {
  validators: require('./validators'),
  validate(fields, rules) {
    let passed = true;
    const allErrors = {};

    for (let field in rules) {
      if (!rules.hasOwnProperty(field)) {
        continue;
      }

      const value = fields[field] === undefined ? '' : fields[field];

      for (let i = 0; i < rules[field].length; i++) {
        const validation = rules[field][i]({name: field, value});

        if (!validation.passed) {
          passed = false;

          if (!allErrors.hasOwnProperty(field)) {
            allErrors[field] = [];
          }

          allErrors[field].push(validation.message);
        }
      }
    }

    return {
      passed,
      getErrors() {
        const errors = [];
        for (let error in allErrors) {
          if (!allErrors.hasOwnProperty(error)) {
            continue;
          }
          errors.push(allErrors[error][0]);
        }
        return errors;
      },
      getAllErrors() {
        let errors = [];
        for (let error in allErrors) {
          if (!allErrors.hasOwnProperty(error)) {
            continue;
          }
          errors = errors.concat(allErrors[error]);
        }
        return errors;
      }
    }
  }
}
