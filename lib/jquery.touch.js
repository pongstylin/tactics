(function($)
{
	var tsEvent;
	var tapEvent;

	$(document).ready(function ()
	{
		$('body')
			.on('touchstart',function (event)
			{
				tsEvent = event;

				// Prevent Mouse Emulation.
				event.preventDefault();
			})
			.on('touchend',function (event)
			{
				if (event.target === tsEvent.target && event.timeStamp - tsEvent.timeStamp < 300)
				{
					$(tsEvent.target).trigger('tap');
				}

				// Prevent Mouse Emulation.
				event.preventDefault();
			})
			.on('tap',function (event,ts,te)
			{
				if (tapEvent && event.target === tapEvent.target && event.timeStamp - tapEvent.timeStamp < 300)
				{
					$(tapEvent.target).trigger('double-tap');
					return tapEvent = undefined;
				}

				tapEvent = event;
			});
	});
})(jQuery);
