window.addEventListener('DOMContentLoaded',  () => {
  const btnFBLogin = document.querySelector(".login-button");
  btnFBLogin.addEventListener("click", function () {
   FB.login(function(response) {
      if (response.authResponse) {
       location.href="online.html";
       
      } else {
       console.log('User cancelled login or did not fully authorize.');
      }
  });
});

});