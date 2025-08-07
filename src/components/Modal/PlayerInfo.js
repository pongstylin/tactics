import 'components/Modal/PlayerInfo.scss';
import Autosave from 'components/Autosave.js';
import Modal from 'components/Modal.js';
import popup from 'components/popup.js';

const authClient = Tactics.authClient;
const gameClient = Tactics.gameClient;

export default class PlayerInfo extends Modal {
  constructor(data, options = {}) {
    options.title = `<SPAN class="playerName">${data.team.name}</SPAN> Info`;
    options.content = `Loading player info...`;

    super(options, data);

    this.root.classList.add('playerInfo');

    this.getPlayerInfo().then(() => {
      this.root.addEventListener('click', this._onClick.bind(this));
    });
  }

  _onClick(event) {
    const { info, team, gameType } = this.data;

    const target = event.target;
    if (target.tagName === 'SPAN' && target.id === "rating_explanation") {
      popup({
        title: 'Forte Rating',
        message: [
          `<DIV> Your <B>Forte</B> rating measures your <I>TAO Skill</I>. It rewards
                 players who are highly successful in many styles.</DIV>`,
          `<BR/>`,
          `<DIV> It is a weighted sum of all styles <B>in which you have played at least 10
                 rated games.</B></DIV>`,
          `<BR/>`,
          `<DIV>Formula: <BR/> <B>(0.5 x R1) + (0.25 x R2) + (0.125 x R3) ...</B> </DIV>`,
          `<BR/>`,
          `<DIV>Where <B>R1</B> is your rating in your highest-rated style, <B>R2</B> is your rating
                in your second highest-rated style, etc.</DIV>`,
        ].join('  '),
        maxWidth: '500px',
      });
    }

    const playerName = info.relationship.name ?? team.name;

    if (target.tagName === 'SPAN' && target.id === "all_ratings") {
      const ratingPaddingLeft = "10px";
      const gameCountPaddingLeft = "25px";
      let messages = [
        `<DIV style='display: grid; text-align: left;'>
           <TABLE cellSpacing=10px> <TR>
             <TH> Style </TH>
             <TH style='padding-left: ${ratingPaddingLeft}'> Rating </TH> 
             <TH style='padding-left: ${gameCountPaddingLeft}'> Games </TH>`,
      ];
      for (const ratingInfo of info.stats.ratings)
        messages.push(`
          <TR>
            <TD>${ratingInfo.gameTypeName}</TD>
            <TD style='padding-left: ${ratingPaddingLeft}'> 
              ${Math.round(ratingInfo.rating)}
            </TD>
            <TD style='padding-left: ${gameCountPaddingLeft}'>
              ${ratingInfo.gameCount}
            </TD>
          </TR>
        `);
      messages.push(`</TABLE> </DIV>`)
      popup({
        title: `<I>${playerName}</I> ratings`,
        message: messages.join(' '),
        maxWidth: '500px',
      });
    }

    if (target.tagName !== 'BUTTON') return;

    if (target.name === 'clearStats')
      popup({
        title: `Clear Overall Stats vs <I>${playerName}</I>?`,
        message: [
          `This will reset your overall stats to zero, but individual style stats will be unaffected.`,
        ].join('  '),
        maxWidth: '300px',
        buttons: [
          { label:'Clear', onClick:() => this.clearStats() },
          { label:'Cancel' },
        ],
      });
    else if (target.name === 'clearStyleStats')
      popup({
        title: `Clear ${gameType.name} Stats vs <I>${playerName}</I>?`,
        message: [
          `This will reset ${gameType.name} stats to zero, but overall stats will be unaffected.`,
        ].join('  '),
        maxWidth: '400px',
        buttons: [
          { label:'Clear', onClick:() => this.clearStyleStats() },
          { label:'Cancel' },
        ],
      });
    else if (target.name === 'close')
      this.close();
  }

  getPlayerInfo() {
    const data = this.data;

    this.renderContent('Please wait...');

    return gameClient.getPlayerInfo(data.game.id, data.team.playerId)
      .then(info => {
        // Just in case the modal was closed before the request completed.
        if (!this.root) return;

        this.data.info = info;
        this.renderInfo();
      })
      .catch(error => {
        this.renderContent('Failed to load player info.');
        throw error;
      });
  }

  static getElapsed(diff) {
    let elapsed;
    if (diff > 86400)
      elapsed = `${Math.floor(diff / 86400)} day(s)`;
    else if (diff > 3600)
      elapsed = `${Math.floor(diff / 3600)} hour(s)`;
    else if (diff > 60)
      elapsed = `${Math.floor(diff / 60)} minute(s)`;
    else
      elapsed = `seconds`;

    return elapsed;
  }

  renderInfo() {
    const data = this.data;
    const info = this.data.info;
    const stats = info.stats;
    const createdDiff = (Date.now() - info.createdAt) / 1000;

    let disposition = '';
    if (info.relationship.reverseType)
      disposition = `<DIV>You were ${info.relationship.reverseType} by this player.</DIV>`;
    else if (data.game.collection) {
      if (info.isNew.get('me') && info.acl.get('them').newAccounts)
        disposition = `<DIV>This player ${info.acl.get('them').newAccounts} you since you are new.</DIV>`;
      else if (!info.isVerified.get('me') && info.acl.get('them').guestAccounts)
        disposition = `<DIV>This player ${info.acl.get('them').guestAccounts} you since you are a guest.</DIV>`;
      else if (info.acl.get('me').muted)
        disposition = `<DIV>You are muted by default by an admin.</DIV>`;
      else if (!info.relationship.type) {
        if (info.isNew.get('them') && info.acl.get('me').newAccounts)
          disposition = `<DIV>This player is new so you ${info.acl.get('me').newAccounts} them.</DIV>`;
        else if (!info.isVerified.get('them') && info.acl.get('me').guestAccounts)
          disposition = `<DIV>This player is a guest so you ${info.acl.get('me').guestAccounts} them.</DIV>`;
        else if (info.acl.get('them').muted)
          disposition = `<DIV>They are muted by default by an admin.</DIV>`;
      }
    }

    const ratingsInfo = this.data.info.stats.ratings;
    const forteRating = ratingsInfo.find(r => r.gameTypeId === 'FORTE')?.rating;
    const styleRating = ratingsInfo.find(r => r.gameTypeId === data.gameType.id)?.rating;
    const content = [
      `<DIV class="relationshipName"></DIV>`,
      `</BR>`,

      // Ratings section
      ...(info.isVerified.get('them') ? [
        `<B>Ratings</B> <SPAN class="all-ratings-link" id="all_ratings"> see all </SPAN>`,
        `<HR>`,
        `<TABLE cellPaddingRight=0 cellSpacingRight=0>`,
        `<TR>`,
          `<TD class="label">Forte <SPAN id="rating_explanation" class="fa fa-info forteRatingExplanation"></SPAN></TD>`,
          `<TD class="label" style="padding-left: 20px;">
            ${data.gameType.name}
          </TD>`,
        `</TR>`,
        `<TR>`,
          `<TD class="label">`,
            `<B>${forteRating ? Math.round(forteRating) : 'None'}</B>`,
          `</TD>`,
          `<TD class="label" style="padding-left: 20px;">`,
            `<B>${styleRating ? Math.round(styleRating) : 'None'}</B>`,
          `</TD>`,
        `</TR>`,
        `</TABLE>`,
      ] : [
        `<B>Ratings</B>`,
        `<HR>`,
        `<DIV>Guests do not have ratings.</DIV>`,
      ]),
      `</BR>`,

      // Matchup History section
      `<B>Matchup History</B>`,
      `<HR>`,
      `<DIV class="wld">`,
        `<DIV>`,
          `Overall`,
          `<DIV class="indent wld">`,
            `<TABLE cellPadding="0" cellSpacing="0">`,
            `<TR>`,
              `<TD class="label">You Win:</TD>`,
              `<TD>`,
                stats.all.win[1] === 0
                  ? `${stats.all.win[0]} game(s)`
                  : `<DIV>${stats.all.win[0]} game(s)</DIV><DIV>+${stats.all.win[1]} with advantage</DIV>`,
              `</TD>`,
            `</TR>`,
            `<TR>`,
              `<TD class="label">You Lose:</TD>`,
              `<TD>`,
                stats.all.lose[1] === 0
                  ? `${stats.all.lose[0]} game(s)`
                  : `<DIV>${stats.all.lose[0]} game(s)</DIV><DIV>+${stats.all.lose[1]} with disadvantage</DIV>`,
            `</TD>`,
            `<TR>`,
              `<TD class="label">Draw:</TD>`,
              `<TD>`,
                stats.all.draw[1] === 0
                  ? `${stats.all.draw[0]} game(s)`
                  : `<DIV>${stats.all.draw[0]} game(s)</DIV><DIV>+${stats.all.draw[1]} with advantage</DIV>`,
              `</TD>`,
            `</TR>`,
            `</TABLE>`,
          `</DIV>`,
          `<CENTER>`,
            `<BUTTON name="clearStats">Reset</BUTTON>`,
          `</CENTER>`,
        `</DIV>`,
        `<DIV>`,
          `${data.gameType.name}`,
          `<DIV class="indent wld">`,
            `<TABLE cellPadding="0" cellSpacing="0">`,
            `<TR>`,
              `<TD class="label">You Win:</TD>`,
              `<TD>`,
                stats.style.win[1] === 0
                  ? `${stats.style.win[0]} game(s)`
                  : `<DIV>${stats.style.win[0]} game(s)<DIV></DIV>+${stats.style.win[1]} with advantage</DIV>`,
              `</TD>`,
            `</TR>`,
            `<TR>`,
              `<TD class="label">You Lose:</TD>`,
              `<TD>`,
                stats.style.lose[1] === 0
                  ? `${stats.style.lose[0]} game(s)`
                  : `<DIV>${stats.style.lose[0]} game(s)</DIV><DIV>+${stats.style.lose[1]} with disadvantage</DIV>`,
            `</TD>`,
            `<TR>`,
              `<TD class="label">Draw:</TD>`,
              `<TD>`,
                stats.style.draw[1] === 0
                  ? `${stats.style.draw[0]} game(s)`
                  : `<DIV>${stats.style.draw[0]} game(s)</DIV><DIV>+${stats.style.draw[1]} with advantage</DIV>`,
              `</TD>`,
            `</TR>`,
            `</TABLE>`,
          `</DIV>`,
          `<CENTER>`,
            `<BUTTON name="clearStyleStats">Reset</BUTTON>`,
          `</CENTER>`,
        `</DIV>`,
      `</DIV>`,
      `</DIV>`,
      `</BR>`,

      // Account details section
      `<DIV>`,
        `<B>Account Details</B>`,
        `<HR>`,
        `<DIV>Account created ${PlayerInfo.getElapsed(createdDiff)} ago.</DIV>`,
        `<DIV>This player is ${info.isVerified.get('them') ? 'verified' : 'a guest'}.</DIV>`,
        `<DIV>This player has completed ${info.completed[0]} game(s).</DIV>`,
        info.canNotify ? `<DIV>This player can be notified when it is their turn.</DIV>` : '',
        disposition,
      `</DIV>`,
    ];

    if (stats.aliases.length && !info.relationship.type)
      content.push(
        `<DIV>`,
          `<DIV>You have played these aliases:</DIV>`,
          `<DIV>`,
            ...stats.aliases.map(a => [
              `<SPAN class="player bronze">`,
                `<SPAN class="count">${a.count}</SPAN>`,
                `<SPAN class="name">${a.name}</SPAN>`,
              `</SPAN>`
            ].join('')),
          `</DIV>`,
        `</DIV>`,
      );

    content.push(
      `<DIV class="controls">`,
        `<BUTTON name="close">Close</BUTTON>`,
      `</DIV>`,
    );

    this.renderContent(content.join(''));

    const playerName = info.relationship.name ?? data.team.name;
    const relationshipName = new Autosave({
      submitOnChange: true,
      defaultValue: false,
      value: playerName,
      maxLength: 20,
      icons: new Map([
        [ 'friended', {
          name: 'user-friends',
          title: 'Friend',
          active: info.relationship.type === 'friended',
          onClick: async friendIcon => {
            if (friendIcon.active) {
              await this.clearRelationship();
              friendIcon.active = false;
            } else {
              await this.friend();
              friendIcon.active = true;
              relationshipName.icons.get('muted').active = false;
              relationshipName.icons.get('blocked').active = false;
            }
          },
        }],
        [ 'muted', {
          name: 'microphone-slash',
          title: 'Mute',
          active: info.relationship.type === 'muted',
          onClick: async muteIcon => {
            if (muteIcon.active) {
              await this.clearRelationship();
              muteIcon.active = false;
            } else {
              popup({
                title: `Mute <I>${playerName}</I>?`,
                message: [
                  `<DIV>If you mute this player, you will:</DIV>`,
                  `<UL>`,
                    `<LI>Disable chat in all games against them.</LI>`,
                    `<LI>Hide chat in all games against them.</LI>`,
                  `</UL>`,
                  `<DIV>You can see a list of all muted players on your account page.</DIV>`,
                ].join('  '),
                buttons: [
                  {
                    label: 'Mute',
                    onClick: async () => {
                      await this.mute();
                      muteIcon.active = true;
                      relationshipName.icons.get('friended').active = false;
                      relationshipName.icons.get('blocked').active = false;
                    }
                  },
                  { label:'Cancel' },
                ],
              });
            }
          },
        }],
        [ 'blocked', {
          name: 'ban',
          title: 'Block',
          active: info.relationship.type === 'blocked',
          onClick: async blockIcon => {
            if (blockIcon.active) {
              await this.clearRelationship();
              blockIcon.active = true;
            } else {
              popup({
                title: `Block <I>${playerName}</I>?`,
                message: [
                  `<DIV>If you block this player, you will:</DIV>`,
                  `<UL>`,
                    `<LI>Disable chat in all games against them.</LI>`,
                    `<LI>Hide chat in all games against them.</LI>`,
                    `<LI>Surrender all active games against them.</LI>`,
                    `<LI>Avoid getting auto matched with them in public games.</LI>`,
                    `<LI>Prevent them from seeing your waiting games.</LI>`,
                    `<LI>Prevent them from joining your shared game links.</LI>`,
                  `</UL>`,
                  `<DIV>You can see a list of all blocked players on your account page.</DIV>`,
                ].join(''),
                buttons: [
                  {
                    label: 'Block',
                    onClick: async () => {
                      await this.block();
                      blockIcon.active = true;
                      relationshipName.icons.get('friended').active = false;
                      relationshipName.icons.get('muted').active = false;
                    }
                  },
                  { label:'Cancel' },
                ],
              });
            }
          },
        }],
      ]),
    }).on('submit', event => event.waitUntil(async () => {
      await this.rename(event.data);
      for (const [ iconName, icon ] of relationshipName.icons) {
        icon.active = iconName === info.relationship.type;
      }
    }));
    relationshipName.appendTo(this.root.querySelector('.relationshipName'));
  }

  rename(newName) {
    return this.setRelationship({ name:newName })
      .then(() => {
        this.data.info.relationship.name = newName;
      });
  }
  friend() {
    return this.setRelationship({ type:'friended' })
      .then(() => {
        this.data.info.relationship.type = 'friended';
        this.renderInfo();
      });
  }
  mute() {
    return this.setRelationship({ type:'muted' })
      .then(() => {
        this.data.info.relationship.type = 'muted';
        this.renderInfo();
      });
  }
  block() {
    return this.setRelationship({ type:'blocked' })
      .then(() => {
        this.data.info.relationship.type = 'blocked';
        this.renderInfo();
      });
  }
  setRelationship(changes) {
    const relationship = Object.assign({
      type: 'friended',
      name: this.data.team.name,
    }, this.data.info.relationship, changes);

    return authClient.setRelationship(this.data.team.playerId, {
      type: relationship.type,
      name: relationship.name,
    }).then(() => this.data.info.relationship = relationship);
  }
  clearRelationship() {
    return authClient.clearRelationship(this.data.team.playerId)
      .then(() => {
        delete this.data.info.relationship.type;
        delete this.data.info.relationship.name;
        this.renderInfo();
      });
  }
  clearStats() {
    return gameClient.clearWLDStats(this.data.team.playerId)
      .then(() => this.getPlayerInfo());
  }
  clearStyleStats() {
    return gameClient.clearWLDStats(this.data.team.playerId, this.data.gameType.id)
      .then(() => this.getPlayerInfo());
  }
}
