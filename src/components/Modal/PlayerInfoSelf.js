import 'components/Modal/PlayerInfo.scss';
import Modal from 'components/Modal.js';
import popup from 'components/popup.js';
import PlayerInfo from 'components/Modal/PlayerInfo';

const authClient = Tactics.authClient;
const gameClient = Tactics.gameClient;

// TODO - Code duplication between this and PlayerInfo Modal.
//        Should be addressed when adding a third modal for spectators to view other players
export default class PlayerInfoSelf extends Modal {
  constructor(data, options = {}) {
    options.title = `<SPAN class="playerName">${data.team.name}</SPAN> Info`;
    options.content = `Loading player info...`;

    super(options, data);

    this.root.classList.add('playerInfo');

    this.getMyInfo().then(() => {
      this.root.addEventListener('click', this._onClick.bind(this));
    });
  }

  _onClick(event) {
    const { info, team } = this.data;

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

    const playerName = team.name;

    if (target.tagName === 'SPAN' && target.id === "all_ratings") {
      const ratingPaddingLeft = "10px";
      const gameCountPaddingLeft = "25px";
      const messages = [
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

    if (target.name === 'close')
      this.close();
  }

  getMyInfo() {
    this.renderContent('Please wait...');

    return gameClient.getMyInfo()
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

  renderInfo() {
    const data = this.data;
    const info = this.data.info;
    const createdDiff = (Date.now() - info.createdAt) / 1000;

    const ratingsInfo = this.data.info.stats.ratings;
    const forteRating = ratingsInfo.find(r => r.gameTypeId === 'FORTE')?.rating;
    const styleRating = ratingsInfo.find(r => r.gameTypeId === data.gameType.id)?.rating;
    const content = [
      // Ratings section
      ...(info.isVerified ? [
        `<B>Ratings</B> <SPAN class="all-ratings-link" id="all_ratings"> see all </SPAN>`,
        `<HR>`,
        `<TABLE cellPaddingRight=0 cellSpacingRight=0>`,
        `<TR>`,
          `<TD class="label">Forte <SPAN id="rating_explanation" class="fa fa-info forteRatingExplanation"></SPAN></TD>`,
          `<TD class="label" style="padding-left: 20px;"> ${data.gameType.name} </TD>`,
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
        `<DIV>Verify your account to receive ratings.</DIV>`,
      ]),
      `</BR>`,

      // Account details section
      `<DIV>`,
        `<B>Account Details</B>`,
        `<HR>`,
        `<DIV>Account created ${PlayerInfo.getElapsed(createdDiff)} ago.</DIV>`,
        `<DIV>You are ${info.isVerified ? 'verified' : 'a guest'}.</DIV>`,
        `<DIV>You have completed ${info.completed[0]} game(s).</DIV>`,
      `</DIV>`,
    ];

    content.push(
      `<DIV class="controls">`,
      `<BUTTON name="close">Close</BUTTON>`,
      `</DIV>`,
    );

    this.renderContent(content.join(''));
  }
}
