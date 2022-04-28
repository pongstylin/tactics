const authClient = Tactics.authClient;
window.addEventListener('DOMContentLoaded',  () => {
   const notice = document.querySelector("#notice");
   notice.innerText="stop oh wait a minute"
  const btnFBLogin = document.querySelector(".fb-login-button");
  btnFBLogin.addEventListener("click", function () {
     location.href="auth/facebook";}
    
  );
  const btndiscordLogin = document.querySelector(".discord-button");
  btndiscordLogin.addEventListener("click", function () {
     location.href="auth/discord";}
    
  );
}); 