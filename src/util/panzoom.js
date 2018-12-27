/*
 * Customized from: https://github.com/dy/pan-zoom
 */
'use strict'

var Impetus = require('impetus')
var touchPinch = require('touch-pinch')
var position = require('touch-position')


module.exports = panZoom


function panZoom (target, cb) {
	if (target instanceof Function) {
		cb = target
		target = document.documentElement || document.body
	}

	if (typeof target === 'string') target = document.querySelector(target)

	//enable panning
	var touch = position.emitter({
		element: target
	})

	var impetus

	var initX = 0, initY = 0, init = true
	var initFn = function (e) { init = true }
	target.addEventListener('touchstart', initFn, { passive: true })

	var lastY = 0, lastX = 0
	impetus = new Impetus({
		source: target,
		update: function (x, y) {
			if (init) {
				init = false
				initX = touch.position[0]
				initY = touch.position[1]
			}

			var e = {
				target: target,
				type: 'touch',
				dx: x - lastX, dy: y - lastY, dz: 0,
				x: touch.position[0], y: touch.position[1],
				x0: initX, y0: initY
			}

			lastX = x
			lastY = y

			schedule(e)
		},
		multiplier: 1,
		friction: .75
	})


	//mobile pinch zoom
	var pinch = touchPinch(target)
	var mult = 2
	var initialCoords

	pinch.on('start', function (curr) {
		var f1 = pinch.fingers[0];
		var f2 = pinch.fingers[1];

		initialCoords = [
			f2.position[0] * .5 + f1.position[0] * .5,
			f2.position[1] * .5 + f1.position[1] * .5
		]

		impetus && impetus.pause()
	})
	pinch.on('end', function () {
		if (!initialCoords) return

		initialCoords = null

		impetus && impetus.resume()
	})
	pinch.on('change', function (curr, prev) {
		if (!pinch.pinching || !initialCoords) return

		schedule({
			target: target,
			type: 'touch',
			dx: 0, dy: 0, dz: - (curr - prev) * mult,
			x: initialCoords[0], y: initialCoords[1],
			x0: initialCoords[0], y0: initialCoords[0]
		})
	})


	// schedule function to current or next frame
	var planned, frameId
	function schedule (ev) {
		if (frameId != null) {
			if (!planned) planned = ev
			else {
				planned.dx += ev.dx
				planned.dy += ev.dy
				planned.dz += ev.dz

				planned.x = ev.x
				planned.y = ev.y
			}

			return
		}

		// Firefox sometimes does not clear webgl current drawing buffer
		// so we have to schedule callback to the next frame, not the current
		// cb(ev)

		frameId = requestAnimationFrame(() => {
			cb(ev)
			frameId = null
			if (planned) {
				var arg = planned
				planned = null
				schedule(arg)
			}
		})
	}

	return function unpanzoom () {
		touch.dispose()

		target.removeEventListener('touchstart', initFn)

		impetus.destroy()

		pinch.disable()

		cancelAnimationFrame(frameId)
	}
}
