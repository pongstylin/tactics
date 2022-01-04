import 'components/ScrollButton.scss';

const iconMap = new Map([
  [ 'up',    'up'   ],
  [ 'down',  'down' ],
  [ 'left',  'up'   ],
  [ 'right', 'down' ],
]);

export default class ScrollButton {
  constructor(props) {
    if (typeof props === 'string')
      props = { direction:props };
    if (!props.direction)
      throw new TypeError('Expected direction property');
    if (!iconMap.has(props.direction))
      throw new TypeError('Unrecognized direction value');

    this.props = Object.assign({}, props);
  }

  render() {
    const direction = this.props.direction;
    const icon = ScrollButton.config.icons[iconMap.get(direction)];

    const btnScroll = document.createElement('BUTTON');
    btnScroll.classList.add('scroll');
    btnScroll.classList.add(direction);

    const hoverSound = ScrollButton.config.howls.hover;
    btnScroll.addEventListener('mouseenter', () => hoverSound.play(), false);

    const clickSound = ScrollButton.config.howls.click;
    btnScroll.addEventListener('click', () => clickSound.play(), false);

    const icoScroll = document.createElement('SPAN');
    icoScroll.style.backgroundImage = `url(${icon})`;
    btnScroll.appendChild(icoScroll);

    return btnScroll;
  }
};

ScrollButton.config = {
  howls: {
    hover: null,
    click: null,
  },
  icons: {
    up: null,
    down: null,
  },
};
