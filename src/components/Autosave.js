import 'components/Autosave.scss';

window.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('focus', event => {
    const target = event.target;
    if (target.matches('.inputTextAutosave INPUT[type=text]'))
      target.select();
  }, true);
  document.body.addEventListener('blur', event => {
    const target = event.target;
    if (target.matches('.inputTextAutosave INPUT[type=text]'))
      // Clear selection
      target.value = target.value;
  }, true);
  document.body.addEventListener('input', event => {
    const target = event.target;
    if (target.matches('.inputTextAutosave INPUT[type=text]')) {
      const inputTextAutosave = event.target.parentElement;
      inputTextAutosave.classList.remove('is-saved');
      inputTextAutosave.classList.remove('is-saving');
    }
  }, true);
});

export default class Autosave {
  constructor(props) {
    this.props = Object.assign({
      icons: new Map(),
      autoFocus: false,
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
    if (this.data.value === value)
      return value;

    return this.input.value = this.data.value = value;
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
    const divError = divAutosave.nextElementSibling;
    const input = this.input = divAutosave.querySelector('INPUT');
    this.data.value = input.value.trim().length ? input.value.trim() : null;

    input.addEventListener('keydown', event => {
      const target = event.target;
      if (event.keyCode === 13)
        this._submit(divAutosave);
      else
        divError.textContent = '';
      event.stopPropagation();
    });
    input.addEventListener('blur', async event => {
      this._change(divAutosave);
    });

    if (this.props.autoFocus)
      setTimeout(() => input.focus());

    return this;
  }

  async _submit(divAutosave) {
    const divError = divAutosave.nextElementSibling;
    const input = this.input;
    const changed = await this._change(divAutosave);

    if (this.props.onSubmit && changed) {
      divAutosave.classList.remove('is-saved');
      divAutosave.classList.add('is-saving');

      try {
        await (this.whenSaved = this.props.onSubmit(input.value));

        this.data.value = input.value;
        divAutosave.classList.remove('is-saving');
        divAutosave.classList.add('is-saved');
      } catch (error) {
        divAutosave.classList.remove('is-saving');
        divError.textContent = error.toString();
      }
    } else
      input.blur();
  }

  async _change(divAutosave) {
    const divError = divAutosave.nextElementSibling;
    const input = this.input;

    let newValue = input.value.trim().length ? input.value.trim() : null;
    if (newValue === null && this.props.isRequired) {
      if (this.props.defaultValue === false)
        newValue = this.data.value;
      else
        newValue = this.props.defaultValue;
    }

    // Just in case spaces were trimmed or the name unset.
    input.value = newValue ?? '';

    if (newValue === this.data.value)
      divAutosave.classList.toggle('is-saved', !this.props.isRequired || this.data.value !== null);
    else {
      divAutosave.classList.remove('is-saved');

      if (this.props.onChange) {
        divAutosave.classList.add('is-saving');

        try {
          await (this.whenSaved = this.props.onChange(newValue));

          divAutosave.classList.remove('is-saving');

          if (!this.props.onSubmit) {
            this.data.value = input.value;
            divAutosave.classList.add('is-saved');
          }
          return true;
        } catch (error) {
          divAutosave.classList.remove('is-saving');
          divError.textContent = error.toString();
        }
      } else
        return true;
    }

    return false;
  }
}
