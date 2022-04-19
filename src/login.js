const authClient = Tactics.authClient;
window.addEventListener('DOMContentLoaded',  () => {
  const btnFBLogin = document.querySelector(".login-button");
  btnFBLogin.addEventListener("click", function () {
     location.href="auth/facebook";}
    
  );
}); 