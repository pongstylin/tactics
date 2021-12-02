/*
 * Throttled user activity detection
 *
 * A user is assumed active for 15 seconds after an event.
 * Once 15 seconds have elapsed, they are considered idle until another event.
 */
let lastActiveDate = new Date();
let isActive = false;
const eventFlags = { capture:true, passive:true };
const setLastActiveDate = () => {
  isActive = true;
  removeActivityEvents();
  setTimeout(() => {
    lastActiveDate = new Date();
    isActive = false;
    addActivityEvents();
  }, 15000);
};
const addActivityEvents = () => {
  window.addEventListener('pointerdown', setLastActiveDate, eventFlags);
  window.addEventListener('pointermove', setLastActiveDate, eventFlags);
  window.addEventListener('pointerup', setLastActiveDate, eventFlags);
};
const removeActivityEvents = () => {
  window.removeEventListener('pointerdown', setLastActiveDate, eventFlags);
  window.removeEventListener('pointermove', setLastActiveDate, eventFlags);
  window.removeEventListener('pointerup', setLastActiveDate, eventFlags);
};

addActivityEvents();

export default () => isActive ? 0 : Math.floor((new Date() - lastActiveDate) / 1000);
