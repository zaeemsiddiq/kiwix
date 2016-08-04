var EXPORTED_SYMBOLS = [ "settings" ];

/* Define the Book class */
function Download(id, gid, completed, status) {
        this.id = id || "";
        this.gid = gid || "";
        this.completed = completed || "0";
	this.status = status || "1";
}

let settings = {

    /* Constructor */
    register: function() {
	/* Create the settings service */
	this.settingsService = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService);
	
	/* Get the root branch */
	this.rootBranch = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefBranch);

	/* Add the observer */
	this.rootBranch.QueryInterface(Components.interfaces.nsIPrefBranch2);
	this.rootBranch.addObserver("", this, false);

	/* Prepare the settings file descriptor */
	var directoryService = Components.classes["@mozilla.org/file/directory_service;1"].getService(Components.interfaces.nsIProperties);
	var settingsDirectory = directoryService.get("PrefD", Components.interfaces.nsIFile);
	this.settingsFile = Components.classes["@mozilla.org/file/local;1"].createInstance();
	this.settingsFile.QueryInterface(Components.interfaces.nsILocalFile);
	this.settingsFile.initWithPath(settingsDirectory.path);
	this.settingsFile.appendRelativePath("prefs.js");

	/* Save the settings directory path */
	this.rootPath = settingsDirectory.path;

	/* Read the file */
	try {
	    this.settingsService.readUserPrefs(this.settingsFile);
	} catch (exception) {
	    /* Do nothing, the file will be create in the future */
	}
    },
    
    /* Destructor */
    unregister: function() {
	if (!this.rootBranch) {
	    return;
	} else {
	    this.rootBranch.removeObserver("", this);
	}
    },

    /* Return the path of the user profile */
    getRootPath: function() {
    	return this.rootPath;
    },

    /* Observer */
    observe: function(aSubject, aTopic, aData) {
	if (aTopic != "nsPref:changed") {
	    return;
	} else {
	    this.save();
	}
    },

    /* Save settings */
    save: function() {
	this.settingsService.savePrefFile(this.settingsFile);
    },

    /* Generic accessor functions */
    charSettingParameter: function(name, value) {
	if (value != undefined) {
	    this.rootBranch.setCharPref(name, value);
	}
	if (this.rootBranch.getPrefType(name) == this.rootBranch.PREF_STRING) { return this.rootBranch.getCharPref(name); }
    },
    
    intSettingParameter: function(name, value) {
	if (value != undefined) {
	    this.rootBranch.setIntPref(name, value);
	}
	if (this.rootBranch.getPrefType(name) == this.rootBranch.PREF_INT) { return this.rootBranch.getIntPref(name); }
    },

    boolSettingParameter: function(name, value) {
	if (value != undefined) {
	    value = (value == "true" || value == true) ? true : false;
	    this.rootBranch.setBoolPref(name, value);
	}
	if (this.rootBranch.getPrefType(name) == this.rootBranch.PREF_BOOL) { return this.rootBranch.getBoolPref(name); }
    },
    
    /* Multiple accessor functions */
    locale: function(value) {
        if (value != undefined) {
	    this.boolSettingParameter("intl.locale.matchOS", false);
        }
    	return this.charSettingParameter("general.useragent.locale", value); 
    },

    addDownload: function(id) {
        var downloadsString = this.downloads();
        var downloadsArray = this.unserializeDownloads(downloadsString);
	for(var i=0;i<downloadsArray.length;i++) {
            var download = downloadsArray[i];
	    if (download.id == id)
	        return false;
	}

	var download = new Download(id, 0, 0, 1);
	downloadsArray.push(download);
	var downloadsString = this.serializeDownloads(downloadsArray);
	this.downloads(downloadsString);
    },

    setDownloadProperty: function(id, name, value) {
        var downloadsString = this.downloads();
        var downloadsArray = this.unserializeDownloads(downloadsString);
	for(var i=0; i<downloadsArray.length; i++) {
	    var download = downloadsArray[i];
	    if (download.id == id) {
		download[name] = value;
	    }
    	}
	var downloadsString = this.serializeDownloads(downloadsArray);
	this.downloads(downloadsString);
    },

    getDownloadProperty: function(id, name) {
        var downloadsString = this.downloads();
        var downloadsArray = this.unserializeDownloads(downloadsString);
	for(var i=0; i<downloadsArray.length; i++) {
	    var download = downloadsArray[i];
	    if (download.id == id) {
               return download[name];
	    }
    	}
    },

    eraseDownloadGids: function() {
        var downloadsString = this.downloads();
        var downloadsArray = this.unserializeDownloads(downloadsString);
	for(var i=0; i<downloadsArray.length; i++) {
	    var download = downloadsArray[i];
            download.gid = "";
    	}
	var downloadsString = this.serializeDownloads(downloadsArray);
	this.downloads(downloadsString);
    },

    serializeDownloads: function(downloadsArray) {
        var downloadsString = "";
	for(var i=0; i<downloadsArray.length; i++) {
            var download = downloadsArray[i];
	    if (download.id != undefined && download.id != "") {
	        var downloadString = download.id + ";" + download.gid + ";" + download.completed + ";" + download.status;
            
		if (downloadsString != "") {
	           downloadsString += "|";
		}
		downloadsString += downloadString;
	    }
	}
	return downloadsString;
    },

    unserializeDownloads: function(downloadsString) {
        var downloadsArray = new Array();
	if (downloadsString != undefined && downloadsString != "") {
            var downloadsStringArray = downloadsString.split('|');
	    for(var i=0; i<downloadsStringArray.length; i++) {
	        var downloadString = downloadsStringArray[i];
	        var downloadStringArray = downloadString.split(';');
	        var download = new Download(downloadStringArray[0], downloadStringArray[1], downloadStringArray[2], downloadStringArray[3]);
	        downloadsArray.push(download);
	    }
        }

	return downloadsArray;
    },

    dataDirectory: function(value) {
        if (value !== undefined) {
	    return this.charSettingParameter("kiwix.dataDirectory", value);
	} else {
	    var path = this.charSettingParameter("kiwix.dataDirectory");
	    if (!path) {
	    	var directoryService = Components.classes["@mozilla.org/file/directory_service;1"].getService(Components.interfaces.nsIProperties);
		var dir = directoryService.get("PrefD", Components.interfaces.nsIFile);
		dir.appendRelativePath("data");
		path = dir.path;
	    }
	    return path;
	}
    },

    invertedColors: function(value) { return this.boolSettingParameter("kiwix.invertedColors", value); },   
    defaultSearchBackend: function(value) { return this.charSettingParameter("kiwix.defaultsearchbackend", value); },
    skin: function(value) { return this.charSettingParameter("general.skins.selectedSkin", value); },
    displayStatusBar: function(value) { return this.boolSettingParameter("displayStatusBar", value); },
    displayFullScreen: function(value) { return this.boolSettingParameter("displayFullScreen", value); },
    displayBookmarksBar: function(value) { return this.boolSettingParameter("displayBookmarksBar", value); },
    windowWidth: function(value) { return this.intSettingParameter("windowWidth", value); },
    windowHeight: function(value) { return this.intSettingParameter("windowHeight", value); },
    windowX: function(value) { return this.intSettingParameter("windowX", value); },
    windowY: function(value) { return this.intSettingParameter("windowY", value); },
    windowMaximized: function(value) { return this.boolSettingParameter("windowMaximized", value); },
    doOnCloseClean: function(value) { return this.boolSettingParameter("doOnCloseClean", value); },
    downloadRemoteCatalogs: function(value) { return this.boolSettingParameter("kiwix.downloadRemoteCatalogs", value); },
    displayTabs: function(value) { return this.boolSettingParameter("kiwix.displayTabs", value); },
    saveTabs: function(value) { return this.boolSettingParameter("kiwix.saveTabs", value); },
    savedTabs: function(value) { return this.charSettingParameter("kiwix.savedTabs", value); },
    defaultFilePickerPath: function(value) { return this.charSettingParameter("defaultFilePickerPath", value); },
    profileToRemove: function(value) { return this.charSettingParameter("profileToRemove", value); },
    libraryUrls: function(value) { return this.charSettingParameter("kiwix.libraryUrls", value); },
    customLibraryPaths: function(value) { return this.charSettingParameter("kiwix.customLibraryPaths", value) || ""; },
    addCustomLibraryPath: function(value) {
      var paths = this.customLibraryPaths();
      if (paths.indexOf(value) == -1) {
      	 paths = paths + value + ";";
      }
      this.customLibraryPaths(paths);
    },
    removeCustomLibraryPath: function(value) {
      var paths = this.customLibraryPaths(); 
      if (paths.indexOf(value) != -1) {
      	 paths = paths.replace(value + ";", "");
      }
      this.customLibraryPaths(paths);
    },
    downloads: function(value) { return this.charSettingParameter("kiwix.downloads", value); },
    zoomFactor: function(id, zoomFactor) { return this.charSettingParameter("kiwix.zoomFactor." + id, zoomFactor); },   
    defaultBookmarksPath: function(value) { return this.charSettingParameter("defaultBookmarksPath", value); },
    bookmarksSets: function(value) { return this.charSettingParameter("bookmarksSets", value); },
    isHighDPI: function(value) { return this.boolSettingParameter("kiwix.isHighDPI", value); },
    neverAskToIndex: function(id, value) {
        if (id === undefined) {
           return this.boolSettingParameter("kiwix.neverAskToIndex", value);
	} else {
	   if (value === undefined) {
	       return this.boolSettingParameter("kiwix.neverAskToIndex." + id, value) || 
	       	      this.boolSettingParameter("kiwix.neverAskToIndex", value);
           } 
	       return this.boolSettingParameter("kiwix.neverAskToIndex." + id, value)
	   
	}
    },
    displayOnCloseCleanConfirmDialog: function(value) { 
    	return this.boolSettingParameter("displayOnCloseCleanConfirmDialog", value); 
    }
}

/* Create the settings object */
settings.register();
