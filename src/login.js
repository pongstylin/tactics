const authClient = Tactics.authClient;
window.addEventListener('DOMContentLoaded',  () => {
  const btnFBLogin = document.querySelector(".fb-login-button");
  btnFBLogin.addEventListener("click", function () {
     location.href="auth/facebook";}
    
  );
  const btndiscordLogin = document.querySelector(".discord-button");
  btndiscordLogin.addEventListener("click", function () {
     location.href="auth/discord";}
    
  );
}); 