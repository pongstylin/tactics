Tactics.utils.getColorStop = function (color1,color2,stop)
{
  var c1R = (color1 >> 16 & 0xFF) / 255;
  var c1G = (color1 >> 8  & 0xFF) / 255;
  var c1B = (color1       & 0xFF) / 255;

  var c2R = (color2 >> 16 & 0xFF) / 255;
  var c2G = (color2 >> 8  & 0xFF) / 255;
  var c2B = (color2       & 0xFF) / 255;

  var cR = c1R*stop + (1-stop)*c2R;
  var cG = c1G*stop + (1-stop)*c2G;
  var cB = c1B*stop + (1-stop)*c2B;

  return (cR*255 << 16) + (cG*255 << 8) + cB*255;
};
