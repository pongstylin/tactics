import 'components/Autosave.scss';
import emitter from 'utils/emitter.js';

window.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('focus', event => {
    const target = event.target;
    if (target.matches('.inputTextAutosave INPUT[type=text]'))
      target.select();
  }, true);
});

let throttle = null;

export default class Autosave {
  constructor(props) {
    this.props = Object.assign({
      icons: new Map(),
      autoFocus: false,
      // Normally, when a value is submitted, it is set.
      // Disable this to control when the value is set.
      autoSetValue: true,
      hideIcons: false,
      // Normally, a user must press Enter to submit the field.
      // Set this to true to also submit on change/blur.
      submitOnChange: false,
      // Normally, a user must press Enter to submit the field.
      // Set this to true to also submit on input
      submitOnInput: false,
      // Requires a value (can't be null/empty-string)
      isRequired: props.defaultValue === false,
      // A value of 'null' means the default value is nothing.
      //   -- This allows you to erase an existing value.
      // A value of 'false' means there is no default value, so fallback on existing value.
      //   -- This allows you to prevent erasing an existing value.
      defaultValue: null,
      // The initial value
      // A value of 'null' is equivalent to an empty string
      value: null,
    }, props);
    this.data = {
      // The current value, set to the initial value at first.
      value: this.props.value,
      icons: new Map(),
    };
    this._root = null;
    this.whenSaved = Promise.resolve();
  }

  get root() {
    return this._root;
  }

  get defaultValue() {
    return this.props.defaultValue;
  }
  set defaultValue(defaultValue) {
    return this.props.defaultValue = defaultValue;
  }

  get value() {
    return this.data.value;
  }
  set value(value) {
    const divAutosave = this._root;
    const spnInput = divAutosave.querySelector('.input SPAN');
    divAutosave.classList.remove('is-saving');
    if (value !== null)
      divAutosave.classList.add('is-saved');

    this.data.value = value;

    if (typeof value === 'string') {
      spnInput.textContent = value;
      this._input.value = value;
    }
  }

  get disabled() {
    return this._input.disabled;
  }
  set disabled(disabled) {
    this._root.classList.toggle('disabled', disabled);
    this._input.disabled = disabled;
  }

  get error() {
    return this._error.textContent;
  }
  set error(error) {
    this._root.classList.remove('is-saving');

    this._error.textContent = error;
  }

  get inputValue() {
    const input = this._input;

    let newValue = input.value.trim().length ? input.value.trim() : null;
    if (newValue === null && this.isRequired) {
      if (this.props.defaultValue === false)
        newValue = this.data.value;
      else
        newValue = this.props.defaultValue;
    }

    return newValue;
  }
  set inputValue(value) {
    this._root.querySelector('.input SPAN').textContent = value;
    this._input.value = value;
  }

  get icons() {
    return this.data.icons;
  }

  focus() {
    this._input.focus();
  }

  appendTo(parent) {
    const props = this.props;
    const divAutosave = document.createElement('DIV');
    divAutosave.classList.add('inputTextAutosave');
    divAutosave.classList.toggle('is-saved', !this.props.isRequired || this.data.value !== null);

    const divInput = document.createElement('DIV');
    divInput.classList.add('input');
    divAutosave.appendChild(divInput);

    const spnInput = document.createElement('SPAN');
    divInput.appendChild(spnInput);

    const input = document.createElement('INPUT');
    input.type = 'text';
    if (typeof props.name === 'string')
      input.name = props.name;
    if (typeof this.data.value === 'string')
      spnInput.textContent = input.value = this.data.value;
    if (typeof props.placeholder === 'string')
      spnInput.textContent = input.placeholder = props.placeholder;
    if (typeof props.maxLength === 'number')
      input.maxLength = props.maxLength;
    input.spellcheck = false;
    divInput.appendChild(input);

    const divIcons = document.createElement('DIV');
    divIcons.classList.add('icons');
    if (props.hideIcons)
      divIcons.classList.add('hide');
    for (const [ iconName, icon ] of props.icons) {
      const spnIcon = document.createElement('SPAN');
      spnIcon.classList.add(iconName, 'fa', `fa-${icon.name}`);
      if (icon.active !== undefined)
        spnIcon.classList.toggle('active', icon.active);
      if (icon.disabled !== undefined)
        spnIcon.classList.toggle('disabled', icon.disabled);
      spnIcon.title = icon.title;

      const iconMutator = {
        get active() {
          return icon.active;
        },
        set active(active) {
          spnIcon.classList.toggle('active', active);
          icon.active = active;
        },

        get disabled() {
          return icon.disabled;
        },
        set disabled(disabled) {
          spnIcon.classList.toggle('disabled', disabled);
          icon.disabled = disabled;
        },

        get title() {
          return icon.title;
        },
        set title(title) {
          spnIcon.title = title;
          icon.title = title;
        },
      };
      this.data.icons.set(iconName, iconMutator);

      spnIcon.addEventListener('click', event => {
        if (!icon.disabled)
          icon.onClick(iconMutator);
      });
      divIcons.appendChild(spnIcon);
    }
    const divSaved = document.createElement('SPAN');
    divSaved.classList.add('saved');
    divSaved.innerHTML = `
      <SPAN class="fa fa-spinner fa-pulse"></SPAN>
      <SPAN class="fa fa-check-circle"></SPAN>
    `;
    divIcons.appendChild(divSaved);

    divAutosave.appendChild(divIcons);

    const divError = document.createElement('DIV');
    divError.classList.add('error');

    parent.appendChild(divAutosave);
    parent.appendChild(divError);

    return this.attach(divAutosave);
  }

  attach(divAutosave) {
    this._root = divAutosave;
    const divError = this._error = divAutosave.nextElementSibling;
    const divInput = divAutosave.querySelector('.input');
    const input = this._input = divInput.querySelector('INPUT');
    this.data.value = input.value.trim().length ? input.value.trim() : null;

    const submit = () => {
      // Double submission can happen on Enter in Chrome
      if (divAutosave.classList.contains('is-saving'))
        return;

      const promises = [];
      const waitUntil = promise => {
        if (typeof promise === 'function')
          promise = promise();

        promises.push(promise);
        return promise;
      };

      const newValue = this.inputValue;
      if (newValue === this.data.value && this.props.autoSetValue) {
        input.blur();

        // Just in case the value was trimmed.
        return this.value = newValue;
      }

      this._emit({ type:'submit', data:newValue, waitUntil });

      if (promises.length) {
        divAutosave.classList.add('is-saving');

        this.whenSaved = Promise.all(promises)
          .then(() => {
            if (this.props.autoSetValue) {
              this.value = newValue;
              this._emit({ type:'change', data:newValue });
              input.blur();
            }
          })
          .catch(error => this.error = error.toString());
      } else if (this.props.autoSetValue) {
        this.value = newValue;
        this._emit({ type:'change', data:newValue });
        input.blur();
      }
    };

    input.addEventListener('keydown', event => {
      divError.textContent = '';
      if (event.keyCode === 13 && !this.props.submitOnInput)
        submit();
      // Allow trap focus to work
      if (event.keyCode !== 9)
        event.stopPropagation();
    });
    input.addEventListener('input', event => {
      divAutosave.classList.remove('is-saved');
      divAutosave.classList.remove('is-saving');
      divInput.querySelector('SPAN').textContent = input.value;
      divError.textContent = '';

      if (this.props.submitOnInput) {
        clearTimeout(throttle);
        throttle = setTimeout(() => submit(), 300);
      }
    });
    input.addEventListener('change', event => {
      this._emit({ type:'change', data:this.inputValue });

      if (this.props.submitOnChange)
        submit();
    });
    input.addEventListener('blur', event => {
      if (this.inputValue === this.data.value && this.props.autoSetValue)
        // Trim
        this.value = this.data.value;
      else
        // Clear selection
        input.value = input.value;

      this._emit({ type:'blur' });
    });

    if (this.props.autoFocus)
      setTimeout(() => input.focus());

    return this;
  }
}

emitter(Autosave);
