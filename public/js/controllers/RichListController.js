angular.module('BlocksApp').controller('RichListController', function($rootScope, $scope, $http, $timeout) {
    $scope.$on('$viewContentLoaded', function() {   
        // initialize core components
        App.initAjax();
    });

    var URL = '/richlist';
    
    $scope.reloadRichlist = function(no) {
      $scope.txLoading = true;
      $http({
        method: 'POST',
        url: URL,
        headers : { 'Content-Type': 'application/x-www-form-urlencoded' },
        transformRequest: function(obj) {
            var str = [];
            for(var p in obj)
            str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
            return str.join("&");
        },
        data: {"action": "latest_richlist", "count": no}
      }).success(function(data) {
            var el =angular.element('#ldrlistbtn');
            el.attr('data-form-id', no);
            
            $scope.latest_richlist = data.result;
            
            if(Object.keys($scope.latest_richlist).length === 0){
                angular.element('#ldrlistbtn').hide();
            }
            
            angular.forEach($scope.latest_richlist, function(addrs){
                var html = '<div class="item">\
                    <div class="item-head">\
                        <div class="" style="float:left">\
                            <a href="/addr/'+addrs.address+'" class="primary-link">'+addrs.address+'</a>\
                        </div>\
                        <div class="" style="float:right">'+addrs.amount+' ETI</div>\
                    </div>\
                </div>';
                angular.element('#richlist-cont').append(html);
            });
            
            $scope.txLoading = false;
      });  
    }
    
    $scope.loadMoreRichList = function() {
        var el =angular.element('#ldrlistbtn');
        el.attr('data-form-id');
        
        var nvl = parseInt(el.attr('data-form-id')) + 20;
        $scope.reloadRichlist(nvl); 
    }
    
    $scope.reloadRichlist(0);
});

