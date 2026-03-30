import { gameConfig } from 'config/client.js';
import seqAsync from 'utils/seqAsync.js';

import Board, {
  TILE_WIDTH,
  TILE_HEIGHT,
} from 'tactics/Board.js';

export default class SetImageRenderer {
  constructor() {
    Object.assign(this, {
      _renderer: null,
      _canvas: null,
      _stage: new PIXI.Container(),
      _content: new PIXI.Container(),

      _board: new Board(),

      data: {
        gameType: null,
        set: null,
      },
    });

    this._stage.addChild(this._content);
  }

  async init() {
    const board = this._board;
    const width = Tactics.width - TILE_WIDTH*2;
    const height = Tactics.height - TILE_HEIGHT*2;
    const renderer = this._renderer = await PIXI.autoDetectRenderer({ width, height, backgroundAlpha:0 });
    this._canvas = renderer.canvas;

    board.draw();
    this._content.addChild(board.pixi);

    this._rotateBoard(true);

    return this;
  }

  /*****************************************************************************
   * Public Methods
   ****************************************************************************/
  _reset(units = this.data.set.units) {
    const board = this._board;
    board.clear();
    board.setState([ units.map(u => Object.assign({ direction:'S' }, u)), [] ], [ { colorId:gameConfig.myColorId }, {} ]);
    board.sortUnits();

    this._highlightPlaces();
    this._renderer.render(this._stage);
  }

  _rotateBoard(force = false) {
    const board = this._board;
    const rotation = gameConfig.rotation;
    if (!force && board.rotation === rotation) return;

    const renderer = this._renderer;
    const content = this._content;

    board.rotate(rotation);

    if (board.rotation === 'N') {
      content.position.set(0, 0);

      const leftPoint = board.getTile(0, 4).getBottom().clone();
      leftPoint.set(
        leftPoint.x + content.position.x + board.pixi.position.x - 1,
        leftPoint.y + content.position.y + board.pixi.position.y - 1,
      );
      const rightPoint = board.getTile(10, 4).getRight().clone();
      rightPoint.set(
        rightPoint.x + content.position.x + board.pixi.position.x - 1,
        rightPoint.y + content.position.y + board.pixi.position.y - 1,
      );
      board.sprite.mask = new PIXI.Graphics();
      board.sprite.mask.poly([
        leftPoint.x, leftPoint.y,
        rightPoint.x, rightPoint.y,
        rightPoint.x, 0,
        0, 0,
        0, Tactics.height,
      ]);
      board.sprite.mask.fill({ color:0xFFFFFF, alpha:1 });
      board.sprite.mask.stroke({ width:1, color:0xFFFFFF, alpha:1 });
    } else if (board.rotation === 'S') {
      content.position.set(renderer.width - Tactics.width, renderer.height - Tactics.height);

      const leftPoint = board.getTile(0, 6).getLeft().clone();
      leftPoint.set(
        leftPoint.x + content.position.x + board.pixi.position.x - 1,
        leftPoint.y + content.position.y + board.pixi.position.y - 1,
      );
      const rightPoint = board.getTile(10, 6).getTop().clone();
      rightPoint.set(
        rightPoint.x + content.position.x + board.pixi.position.x - 1,
        rightPoint.y + content.position.y + board.pixi.position.y - 1,
      );

      board.sprite.mask = new PIXI.Graphics();
      board.sprite.mask.poly([
        leftPoint.x, leftPoint.y,
        rightPoint.x, rightPoint.y,
        Tactics.width, rightPoint.y,
        Tactics.width, Tactics.height,
        0, Tactics.height,
      ]);
      board.sprite.mask.fill({ color:0xFFFFFF, alpha:1 });
      board.sprite.mask.stroke({ width:1, color:0xFFFFFF, alpha:1 });
    } else if (board.rotation === 'E') {
      content.position.set(renderer.width - Tactics.width, 0);

      const leftPoint = board.getTile(6, 0).getLeft().clone();
      leftPoint.set(
        leftPoint.x + content.position.x + board.pixi.position.x - 1,
        leftPoint.y + content.position.y + board.pixi.position.y - 1,
      );
      const rightPoint = board.getTile(6, 10).getBottom().clone();
      rightPoint.set(
        rightPoint.x + content.position.x + board.pixi.position.x - 1,
        rightPoint.y + content.position.y + board.pixi.position.y - 1,
      );
      board.sprite.mask = new PIXI.Graphics();
      board.sprite.mask.poly([
        leftPoint.x, leftPoint.y,
        rightPoint.x, rightPoint.y,
        Tactics.width, rightPoint.y,
        Tactics.width, 0,
        0, 0,
      ]);
      board.sprite.mask.fill({ color:0xFFFFFF, alpha:1 });
      board.sprite.mask.stroke({ width:1, color:0xFFFFFF, alpha:1 });
    } else if (board.rotation === 'W') {
      content.position.set(0, renderer.height - Tactics.height);

      const leftPoint = board.getTile(4, 0).getTop().clone();
      leftPoint.set(
        leftPoint.x + content.position.x + board.pixi.position.x - 1,
        leftPoint.y + content.position.y + board.pixi.position.y - 1,
      );
      const rightPoint = board.getTile(4, 10).getRight().clone();
      rightPoint.set(
        rightPoint.x + content.position.x + board.pixi.position.x - 1,
        rightPoint.y + content.position.y + board.pixi.position.y - 1,
      );
      board.sprite.mask = new PIXI.Graphics();
      board.sprite.mask.poly([
        leftPoint.x, leftPoint.y,
        rightPoint.x, rightPoint.y,
        rightPoint.x, Tactics.height,
        0, Tactics.height,
        0, 0,
      ]);
      board.sprite.mask.fill({ color:0xFFFFFF, alpha:1 });
      board.sprite.mask.stroke({ width:1, color:0xFFFFFF, alpha:1 });
    }
  }

  async getImage(gameType, set) {
    return (this._getImage ??= seqAsync((gameType, set) => {
      this.data.gameType = gameType;
      this.data.set = set;
      this._rotateBoard();
      this._reset();

      return new Promise(resolve => this._canvas.toBlob(blob => resolve(URL.createObjectURL(blob)), 'image/png'));
    }))(gameType, set);
  }

  /*****************************************************************************
   * Private Methods
   ****************************************************************************/
  _highlightPlaces() {
    const board = this._board;
    board.clearHighlight();

    const tiles = this.data.gameType.getAvailableTiles(this._board);
    const noplaces = [];
    const masked = [];
    const blacked = [];

    for (let x = 0; x < 11; x++) {
      for (let y = 0; y < 11; y++) {
        const tile = board.getTile(x, y);
        if (!tile) continue;

        if (!tiles.has(tile)) {
          tile.set_interactive(!!tile.assigned);
          noplaces.push(tile);

          if (board.rotation === 'N' && tile.y >= 5)
            masked.push(tile);
          else if (board.rotation === 'S' && tile.y <= 5)
            masked.push(tile);
          else if (board.rotation === 'E' && tile.x <= 5)
            masked.push(tile);
          else if (board.rotation === 'W' && tile.x >= 5)
            masked.push(tile);
          else
            blacked.push(tile);
        }
      }
    }

    board.setHighlight(masked, {
      action: 'masked',
      color: 0x000000,
      alpha: 0,
    }, true);

    board.setHighlight(blacked, {
      action: 'noplace',
      color: 0x000000,
      alpha: 0.3,
    }, true);

    return { noplaces };
  }
};
