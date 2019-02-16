const validator = require('./validator/index');

module.exports = {
  validators: {
    register: data => ({
      username: [validator.validators.required, validator.validators.min(2)],
      password: [validator.validators.required, validator.validators.matches(data.passwordConfirm)],
    }),
    login: () => ({
      username: [validator.validators.required, validator.validators.max(15)],
      password: [validator.validators.required],
    }),
    message: [validator.validators.required, validator.validators.max(50)],
    joinGame: () => ({
      gameId: [validator.validators.required, validator.validators.exactly(36)],
    })
  },
}
