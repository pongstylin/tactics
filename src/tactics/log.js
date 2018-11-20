(function ()
{
  var db = [];
  var trace = {};
  var self = {};

  $.extend(self,
  {
    trace:function (t)
    {
      $.extend(trace,t);
    },
    store:function (indexes,data)
    {
      if (typeof data === 'string') data = [data];

      db.push({indexes:$.extend(indexes,trace),data:data});

      return self;
    },
    query:function (indexes)
    {
      $.each(db,function (i,row)
      {
        var pass = true;

        if (indexes)
        {
          $.each(indexes,function (k,v)
          {
            if (row.indexes[k] === v) return;
            return pass = false;
          });
        }

        if (pass) console.log.apply(console,row.data);
      });

      return self;
    },
    clear:function ()
    {
      db = [];

      return self;
    }
  });

  Tactics.log = self;
})();
