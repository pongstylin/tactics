import 'components/Autosave.scss';
import emitter from 'utils/emitter.js';

window.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('focus', event => {
    const target = event.target;
    if (target.matches('.inputTextAutosave INPUT[type=text]'))
      target.select();
  }, true);
});

export default class Autosave {
  constructor(props) {
    this.props = Object.assign({
      icons: new Map(),
      autoFocus: false,
      // Normally, a user must press Enter to submit the field.
      // Set this to true to also submit on change/blur.
      submitOnChange: false,
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
    this.whenSaved = Promise.resolve();
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
    divAutosave.classList.remove('is-saving');
    divAutosave.classList.add('is-saved');

    return this._input.value = this.data.value = value;
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
    if (newValue === null && this.props.isRequired) {
      if (this.props.defaultValue === false)
        newValue = this.data.value;
      else
        newValue = this.props.defaultValue;
    }

    return newValue;
  }

  get icons() {
    return this.data.icons;
  }

  appendTo(parent) {
    const props = this.props;
    const divAutosave = document.createElement('DIV');
    divAutosave.classList.add('inputTextAutosave');
    divAutosave.classList.toggle('is-saved', !this.props.isRequired || this.data.value !== null);

    const input = document.createElement('INPUT');
    input.type = 'text';
    if (typeof props.name === 'string')
      input.name = props.name;
    if (typeof this.data.value === 'string')
      input.value = this.data.value;
    if (typeof props.placeholder === 'string')
      input.placeholder = props.placeholder;
    if (typeof props.maxLength === 'number')
      input.maxLength = props.maxLength;
    input.spellcheck = false;

    const divIcons = document.createElement('DIV');
    divIcons.classList.add('icons');
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

    divAutosave.appendChild(input);
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
    const input = this._input = divAutosave.querySelector('INPUT');
    this.data.value = input.value.trim().length ? input.value.trim() : null;

    const submit = () => {
      const promises = [];
      const waitUntil = promise => {
        if (typeof promise === 'function')
          promise = promise();

        promises.push(promise);
        return promise;
      };

      const newValue = this.inputValue;
      if (newValue === this.data.value)
        // Just in case the value was trimmed.
        return this.value = newValue;

      this._emit({ type:'submit', data:newValue, waitUntil });

      if (promises.length) {
        divAutosave.classList.add('is-saving');

        this.whenSaved = Promise.all(promises)
          .then(() => {
            this.value = newValue;
            input.blur();
          })
          .catch(error => this.error = error.toString());
      }
    };

    input.addEventListener('keydown', event => {
      const target = event.target;
      if (event.keyCode === 13)
        submit();
      event.stopPropagation();
    });
    input.addEventListener('input', event => {
      divAutosave.classList.remove('is-saved');
      divAutosave.classList.remove('is-saving');
      divError.textContent = '';
    });
    input.addEventListener('change', event => {
      this._emit({ type:'change', data:this.inputValue });

      if (this.props.submitOnChange)
        submit();
    });
    input.addEventListener('blur', event => {
      if (this.inputValue === this.data.value)
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
