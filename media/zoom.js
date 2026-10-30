let imageSelector = 'figure, :not(figure) > img';
let factor = 1.01;
var scale = 1;
var zoomX = 0;
var zoomY = 0;
var currentImage = null;
var start = null;
var panning = false;

function setTransform(image, translateX, translateY, scale) {
	image.style.transform = "translate(" + translateX + "px, " + translateY + "px) scale(" + scale + ")";
}

function resetTransform(image) {
	setTransform(image, 0, 0, 1);
}

function tagCurrentZoomableImage(image) {
	if (!image.classList.contains("fluentmark_zoom")) {
		image.classList.add("fluentmark_zoom");
	}
}

function untagCurrentZoomableImage(image) {
	image.classList.remove("fluentmark_zoom");
}

function setCursor(image, cursor) {
	image.style.cursor = cursor;
}

function setZoomInCursor(image) {
	setCursor(image, "zoom-in");
}

function setZoomOutCursor(image) {
	setCursor(image, "zoom-out");
}

function setGrabbingCursor(image) {
	setCursor(image, "grabbing");
}

function resetAllImages() {
	var allImages = document.body.querySelectorAll(imageSelector);
	for (let n = 0; n < allImages.length; n++) {
		untagCurrentZoomableImage(allImages[n]);
		resetTransform(allImages[n]);
		setZoomInCursor(allImages[n]);
	}
	
	scale = 1;
	zoomX = 0;
	zoomY = 0;
	currentImage = null;
	start = null;
	panning = false;
}

function updateCurrentImage(newCurrentImage) {
	if (currentImage != newCurrentImage) {
		scale = 1;
		zoomX = 0;
		zoomY = 0;
		currentImage = newCurrentImage;
		start = null;
		panning = false;
			
		var allImages = document.body.querySelectorAll(imageSelector);
		for (let n = 0; n < allImages.length; n++) {
			if (allImages[n] == currentImage) {
				tagCurrentZoomableImage(allImages[n]);
			} else {
				untagCurrentZoomableImage(allImages[n]);
				resetTransform(allImages[n]);
				setZoomInCursor(allImages[n]);
			}
		}
	}
}

function refreshImages() {
	try {
	
	scale = 1;
	zoomX = 0;
	zoomY = 0;
	currentImage = null;
	start = null;
	panning = false;
		
	var images = document.body.querySelectorAll(imageSelector);
	
	for (let i = 0; i < images.length; i++) {
		resetTransform(images[i]);
		
		images[i].onwheel=function(e) {
			if (e.altKey != true) {
				return
			}
			e.preventDefault();
			
			document.getElementById("zoom-hint").style.opacity = 0;
			
			updateCurrentImage(images[i]);
				
			var rect = images[i].getBoundingClientRect();
			var move = (e.wheelDelta ? e.wheelDelta : -e.deltaY);
				
			if (move > 0) {
				setZoomInCursor(images[i])
			} else {
				setZoomOutCursor(images[i])
			}
				
			if (move > 0) {
				zoomX = e.clientX - (e. clientX - rect.left) * factor - rect.left + zoomX;
				zoomY = e.clientY - (e.clientY - rect.top) * factor - rect.top + zoomY;
				scale = scale * factor;
			} else {
				zoomX = e.clientX - (e. clientX - rect.left) / factor - rect.left + zoomX;
				zoomY = e.clientY - (e.clientY - rect.top) / factor - rect.top + zoomY;
				scale = scale / factor;
			}
				
			setTransform(currentImage, zoomX, zoomY, scale);
		};

		images[i].onmousedown=function(e) {
			e.preventDefault();
			
			updateCurrentImage(images[i]);
			
			start = { x : e.clientX - zoomX, y : e.clientY - zoomY };
			panning = true;
			
			setGrabbingCursor(images[i]);
		};
		
		images[i].onmouseup=function(e) {
			panning = false;
			
			setZoomInCursor(images[i])
		};
		
		images[i].onmousemove=function(e) {
			e.preventDefault();
			
			if (panning) {
				document.getElementById("zoom-hint").style.opacity = 0;
				
				zoomX = e.clientX - start.x;
				zoomY = e.clientY - start.y;
				
				setTransform(images[i], zoomX, zoomY, scale);
			} else {
				var tooltip = document.getElementById("zoom-hint");
				
				if (tooltip.style.opacity != 1) {
					return;
				}
				
				var x = e.clientX;
				var y = e.clientY;
				
				tooltip.style.left = x + "px";
				tooltip.style.top = (y + 20) + "px";
			}
		};
		
		images[i].onmouseenter=function(e) {
			document.getElementById("zoom-hint").style.opacity = 1;
		}
		
		images[i].onmouseleave=function(e) {
			document.getElementById("zoom-hint").style.opacity = 0;
		}
		
		images[i].addEventListener('contextmenu', function (e) {
			e.preventDefault();
			
			document.getElementById("zoom-hint").style.opacity = 0;
			
			resetAllImages();
			return false;
		}, false);
	}
	
	} catch (error) {
		alert(error);
	}
}

function reloadLocalImages() {
	try {
	var foundImages = document.body.getElementsByTagName('img');
	var imgUrl = null;
	
	for (var k = 0; k < foundImages.length; k++) {
		if (foundImages[k].src != null) {
			imgUrl = foundImages[k].src;
			
			if (!imgUrl.startsWith('http://') && !imgUrl.startsWith('https://')) {
				fetch(imgUrl, {cache: 'reload', mode: 'no-cors'})
					.then(response => {
						foundImages[k].src = response.url;
					});
			}
		}
	}
	} catch (error) {
		alert (error);
	}
}
