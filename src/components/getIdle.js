/*
 * Throttled user activity detection
 *
 * A user is assumed active for 15 seconds after an event.
 * Once 15 seconds have elapsed, they are considered idle until another event.
 */
let lastActiveDate = new Date();
let isActive = false;
let setLastActiveDate = () => {
  isActive = true;
  removeActivityEvents();
  setTimeout(() => {
    lastActiveDate = new Date();
    isActive = false;
    addActivityEvents();
  }, 15000);
}
let addActivityEvents = () => {
  window.addEventListener('pointerdown', setLastActiveDate, { capture:true, passive:true });
  window.addEventListener('pointermove', setLastActiveDate, { capture:true, passive:true });
  window.addEventListener('pointerup', setLastActiveDate, { capture:true, passive:true });
};
let removeActivityEvents = () => {
  window.removeEventListener('pointerdown', setLastActiveDate);
  window.removeEventListener('pointermove', setLastActiveDate);
  window.removeEventListener('pointerup', setLastActiveDate);
};

addActivityEvents();

export default () => isActive ? 0 : Math.floor((new Date() - lastActiveDate) / 1000);
