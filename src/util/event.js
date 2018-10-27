window.utils = window.utils || {};

(function ()
{
	utils.addEvents = function ()
	{
		var self = this;
		var events = {};

		$.extend(self,
		{
			on:function (types,fn)
			{
				$.each(types.split(' '),function (i,type)
				{
					events[type] = events[type] || [];
					events[type].push(fn);
				});

				return self;
			},

			emit:function (event)
			{
				$.each(events[event.type] || [],function (i,fn)
				{
					fn.call(self,event);
				});

				return self;
			},

			off:function (types,fn)
			{
				if (types)
				{
					$.each(types.split(' '),function (i,type)
					{
						if (!events[type]) return;

						if (fn)
						{
							if ((i = events[type].indexOf(fn)) > -1)
								events[type].splice(i,1);
						}
						else
						{
							delete events[type];
						}
					});
				}
				else
				{
					events = {};
				}

				return self;
			}
		});

		return self;
	};
})();
