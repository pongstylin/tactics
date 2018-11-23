(function ()
{
  Tactics.units[15].extend = function (self)
  {
    var data = Tactics.units[self.type];
    var sounds = $.extend({},Tactics.sounds,data.sounds);
    var board = Tactics.board;

    // Hacky
    $.each(data.frames,function (i,frame)
    {
      data.frames[i].c[0].n = 'shadow';
      data.frames[i].c[2].n = 'trim';
    });

    $.extend(self,
    {
      title:'...sleeps...',

      phase:function (color)
      {
        var deferred = $.Deferred();
        var choices = [];

        if (color === undefined)
        {
          $.each(board.getWinningTeams().reverse(),function (i,team)
          {
            if (team.units.length === 0) return;
            if (choices.length && team.score > choices[0].score) return false;

            choices.push(team);
          });

          color = choices.random().color;
        }

        if (color === board.teams[self.team].color)
          deferred.resolve();
        else
          self.animPhase(color).play(function () { deferred.resolve(); });

        return deferred.promise();
      },
      animPhase:function (color)
      {
        var step = 12;
        var fcolor = self.color;
        var tcolor = color === null ? 0xFFFFFF : Tactics.colors[color];

        return new Tactics.Animation({fps:12,frames:
        [
          function ()
          {
            sounds.phase.play();
            board.teams[self.team].color = color;
            self.color = tcolor;
          },
          {
            script:function ()
            {
              self.pixi.children[0].children[2].tint = Tactics.utils.getColorStop(fcolor,tcolor,--step / 12);
            },
            repeat:12
          }
        ]});
      },
      animAttack:function (attacker)
      {
        var anim = new Tactics.Animation();
        var pixi = self.pixi;
        var step = 0;
        var targets = [],target,changes = {};
        var winds = ['wind1','wind2','wind3','wind4','wind5'].randomize();

        if (attacker.color === self.color)
        {
          $.each(board.getWinningTeams(),function (i,team)
          {
            if (team.id === self.team || Tactics.colors[team.color] === self.color) return;

            targets = team.units.slice();
            return false;
          });

          if (!targets.length) return;
        }
        else
        {
          $.each(board.teams[attacker.team].units,function (i,unit)
          {
            targets.push(unit);
          });
        }

        target = targets.random();
        changes.mHealth  = target.mHealth;
        changes.mHealth -= Math.round(self.power * (1 - target.armor / 100));
        changes.mHealth  = Math.max(changes.mHealth,-target.health);

        anim
          .addFrames
          ([
            {
              script:function ()
              {
                self.brightness(1 + (++step * 0.2));
                self.frame.tint = Tactics.utils.getColorStop(self.color,0xFFFFFF,step / 12);

                // Shadow
                self.frame.children[0].scale.x = 1 - (step * 0.025);
                self.frame.children[0].scale.y = 1 - (step * 0.025);
                self.frame.children[0].position.x += 0.3;
                self.frame.children[0].position.y += 0.2;

                // Base
                self.frame.children[1].position.y -= 3;

                // Trim
                self.frame.children[2].position.y -= 3;
              },
              repeat:12
            },
            {
              script:function ()
              {
                self.brightness(1 + (--step * 0.2));
              },
              repeat:6,
            },
            {
              script:function ()
              {
                self.brightness(1 + (++step * 0.2),(step-6) * 0.6);
              },
              repeat:6,
            }
          ])
          .addFrames
          ([
            {
              script:function ()
              {
                self.brightness(1 + (--step * 0.2),(step-6) * 0.6);
              },
              repeat:6,
            },
            {
              script:function ()
              {
                self.brightness(1 + (++step * 0.2));
              },
              repeat:6,
            },
            {
              script:function ()
              {
                self.brightness(1 + (--step * 0.2));
                self.frame.tint = Tactics.utils.getColorStop(self.color,0xFFFFFF,step / 12);

                // Shadow
                self.frame.children[0].scale.x = 1 - (step * 0.025);
                self.frame.children[0].scale.y = 1 - (step * 0.025);
                self.frame.children[0].position.x -= 0.3;
                self.frame.children[0].position.y -= 0.2;

                // Base
                self.frame.children[1].position.y += 3;

                // Trim
                self.frame.children[2].position.y += 3;
              },
              repeat:12
            },
          ])
          .splice(0,function () { sounds.wind.play(winds.shift()).fadeIn(0.25,500); })
          .splice(4,function () { sounds.wind.play(winds.shift()); })
          .splice(8,function () { sounds.wind.play(winds.shift()); })
          .splice(12,function ()
          {
            sounds.roar.play('roar');
          })
          .splice(16,function () { sounds.wind.play(winds.shift()); })
          .splice(20,function () { sounds.wind.play(winds.shift()).fadeOut(0,1700); });

        return anim.splice(22,self.animLightning(target.assignment,changes))
      },
      animAssist:function (attacker)
      {
        var anim = new Tactics.Animation();
        var pixi = self.pixi;
        var filter = new PIXI.filters.ColorMatrixFilter();
        var step = 0;
        var targets = [],target;

        pixi.filters = [filter];

        if (attacker.color === self.color)
        {
          $.each(board.teams[attacker.team].units,function (i,unit)
          {
            if (unit.mHealth >= 0) return;
            targets.push(unit);
          });
        }
        else
        {
          $.each(board.teams,function (i,team)
          {
            if (i === self.team || Tactics.colors[team.color] !== self.color) return;

            $.each(team.units,function (i,unit)
            {
              if (unit.mHealth >= 0) return;
              targets.push(unit);
            });
          });
        }

        if (!targets.length) return;

        target = targets.random();

        anim
          .addFrame
          ({
            script:function ()
            {
              filter.brightness(1 + (++step * 0.2));
              pixi.children[0].children[1].tint = Tactics.utils.getColorStop(self.color,0xFFFFFF,step / 12);
              if (step === 8) sounds.heal.play();
            },
            repeat:12
          })
          .splice(self.animHeal(target))
          .addFrame
          ({
            script:function ()
            {
              var mHealth;

              filter.brightness(1 + (--step * 0.2));
              pixi.children[0].children[1].tint = Tactics.utils.getColorStop(self.color,0xFFFFFF,step / 12);

              if (step === 11)
              {
                mHealth = target.mHealth + self.power;
                if (mHealth > 0) mHealth = 0;

                target.change({mHealth:mHealth});
                board.drawCard(target);
              }
              if (step === 0) pixi.filters = null;
            },
            repeat:12
          }).splice(target.animCaption('Nice'));

        return anim;
      },
      animStrike:function (attacker,direction)
      {
        return new Tactics.Animation({frames:
        [
          function ()
          {
            sounds.crack.play();
          },
          function ()
          {
            self.shock(direction,1);
          },
          function ()
          {
            self.shock();
          }
        ]});
      },
      animStagger:function (attacker,direction,changes)
      {
        var anim = new Tactics.Animation();

        anim.addFrames
        ([
          function ()
          {
          },
          function ()
          {
            self.offsetFrame(0.06,direction);
          },
          function ()
          {
            self.offsetFrame(-0.06,direction);
          },
          function ()
          {
            self.offsetFrame(-0.06,direction);
          },
          function ()
          {
            self.offsetFrame(0.06,direction);
          }
        ]);

        if (changes.mHealth > -self.health)
          anim.splice(self.animAttack(attacker));

        return anim;
      },
      animBlock:function (attacker,direction)
      {
        return new Tactics.Animation({frames:
        [
          function ()
          {
            self.direction = direction;
          },
          function ()
          {
            sounds.block.play();
            self.shock(direction,0);
          },
          function ()
          {
            self.shock(direction,1);
          },
          function ()
          {
            self.shock(direction,2);
          },
          function ()
          {
            self.shock();
          }
        ]}).splice(self.animAssist(attacker));
      },
      animDeath:function (attacker)
      {
        var anim = new Tactics.Animation();
        var assignment = self.assignment;
        var direction = board.getDirection(assignment,attacker.assignment);
        var frames = attacker.walks[direction];
        var step = 0,step2 = 0,step3 = 0;
        var myPos = assignment.getCenter();
        var pos = attacker.pixi.position.clone();
        var caption,dragon,hatch = Tactics.units[22].animations[direction].hatch;
        var team = board.teams[self.team],tint = self.color;
        var death = new PIXI.Container();
        var winds = ['wind1','wind2','wind3','wind4','wind5'];

        if (direction === 'S')
        {
          caption = {x:9};
        }
        else if (direction === 'N')
        {
          caption = {y:-9,x:-9};
        }
        else if (direction === 'E')
        {
          caption = {y:-9,x:9};
        }
        else
        {
          caption = {x:-9};
        }

        anim
          .splice // 0
          ({
            script:function ()
            {
              if (step === 0) sounds.phase.play();
              self.whiten(++step / 12);
              self.frame.children[2].tint = Tactics.utils.getColorStop(0xFFFFFF,tint,step / 12);
            },
            repeat:12
          })
          .splice // 12
          ({
            script:function ()
            {
              self.whiten(--step / 12);
            },
            repeat:12
          })
          .splice // 24
          ({
            script:function ()
            {
              if (step === 0) sounds.phase.play();
              self.alpha = 1 - (++step / 12)
            },
            repeat:12
          })
          .splice(36,function ()
          {
            board
              .dropUnit(self)
              .addUnit(self.team,
              {
                t:22,
                tile:assignment,
                direction:direction
              });

            dragon = team.units[0];
            dragon.color = 0xFFFFFF;
            dragon.drawFrame(hatch.s);
          })
          .splice(36,
          {
            script:function ()
            {
              dragon.frame.alpha = 1 - (--step / 12);
            },
            repeat:12
          })
          .splice(22,attacker.animTurn(direction))
          .splice(24,
          {
            script:function ()
            {
              var offset = ((step2 / (frames.length*3)) * 0.45) + 0.12;
              offset = new PIXI.Point(Math.round(88*offset),Math.round(56*offset));

              if ((step2 % frames.length) === 0 || (step2 % frames.length) === 4)
                Tactics.units[0].sounds.step.play();

              attacker.drawFrame(frames[step2++ % frames.length]);

              // Opposite of what you expect since we're going backwards.
              if (direction === 'S')
              {
                attacker.pixi.position.x = pos.x - offset.x;
                attacker.pixi.position.y = pos.y - offset.y;
              }
              else if (direction === 'N')
              {
                attacker.pixi.position.x = pos.x + offset.x;
                attacker.pixi.position.y = pos.y + offset.y;
              }
              else if (direction === 'E')
              {
                attacker.pixi.position.x = pos.x - offset.x;
                attacker.pixi.position.y = pos.y + offset.y;
              }
              else
              {
                attacker.pixi.position.x = pos.x + offset.x;
                attacker.pixi.position.y = pos.y - offset.y;
              }
            },
            repeat:frames.length*3
          })
          .splice(22,attacker.animCaption('Ugh!',caption))
          .splice(function () // 48
          {
            // Useful for bots
            attacker.mHealth = -attacker.health;
            board.dropUnit(attacker);
          })
          .splice // 49
          ({
            script:function ()
            {
              if (step === 0) sounds.phase.play();
              dragon.whiten(++step / 12);
              if (step < 7) dragon.alpha = step / 6;
            },
            repeat:12
          })
          .splice // 61
          ({
            script:function ()
            {
              dragon.whiten(--step / 12);
            },
            repeat:12
          })
          .splice // 73
          ({
            script:function ()
            {
              dragon.drawFrame(hatch.s + ++step);
            },
            repeat:hatch.l-3
          })
          .splice // 78
          ({
            script:function ()
            {
              dragon.frame.children[2].tint = Tactics.utils.getColorStop(tint,0xFFFFFF,++step3/12);
            },
            repeat:12
          })
          .splice
          ({
            script:function ()
            {
              dragon.color = tint;
              dragon.drawFrame(hatch.s + ++step);
            },
            repeat:2
          });

        // Layer in the cloud
        anim.splice( 0,function () { self.pixi.addChild(death);      });
        anim.splice(36,function () { dragon.pixi.addChild(death);    });
        anim.splice(51,function () { dragon.pixi.removeChild(death); });

        $.each(anim.frames,function (i)
        {
          var po = Math.min(1,Math.max(0.05,i / anim.frames.length) + 0.05);
          var ao = 0.5;

          if (i === 51) return false;
          if (i < 20)
          {
            ao = (i+1) * 0.025;
          }
          else if (i > 40)
          {
            ao -= (i-40) * 0.05;
          }

          $.each([1,-1],function (j,xm)
          {
            $.each([1,-1],function (k,ym)
            {
              var x = myPos.x + Math.round(Math.random() * 44 * po)*xm;
              var y = myPos.y + Math.round(Math.random() * 28 * po)*ym + 28;
              var animDeath = new Tactics.Animation.fromData(Tactics.stage.children[1],Tactics.animations.death,{x:x,y:y,s:2,a:ao});

              anim.splice(i,animDeath);
            });
          });
        });

        $.each(anim.frames,function (i)
        {
          var play = i % 4;
          if (play  >   0) return;
          if (i    === 84) return false;

          if (i === 0)
          {
            anim.splice(i,function ()
            {
              sounds.wind.play(winds.random()).fadeIn(0.25,500);
            });
          }
          else if (i === 76)
          {
            anim.splice(i,function ()
            {
              sounds.roar.play('roar');
            });
          }
          else
          {
            anim.splice(i,function ()
            {
              sounds.wind.play(winds.random());
            });
          }
        });

        if (!board.teams[board.turns[0]].bot)
        {
          anim.splice(anim.frames.length-1,function ()
          {
            board.endTurn();
          });
        }

        return anim;
      }
    });

    return self;
  };
})();
