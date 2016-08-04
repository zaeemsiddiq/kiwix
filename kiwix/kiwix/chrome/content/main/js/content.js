/*
 * Copyright 2011 Emmanuel Engelhart <kelson@kiwix.org>
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU  General Public License as published by
 * the Free Software Foundation; either version 3 of the License, or
 * any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston,
 * MA 02110-1301, USA.
 */
//var _selectedLibraryContentItem = undefined;
var aria2Client = new xmlrpc_client("rpc", "localhost", "42042", "http");
var jobTimer = null;
var downloader = new Worker("js/downloader.js");
var downloadsResumed = false;
var _oldWindowTitle = "";
var _libraryKeyCursorOnMenu = false;
var _isDownloaderRunningTimestamp = Number(new Date());
var _isDownloaderRunning = false;
//var _isOnline = undefined;
var checkDownloaderId;
var checkDownloadStatusId;
var updateOnlineStatusId;

downloader.onmessage = function(event) {
    var message = event.data;
    if (message.id == "updateOnlineStatus") {
        _isOnline = message.parameters[0];
    } else if (message.id == "downloadedMetalink") {
        addMetalink(message.parameters[0], message.parameters[1]);
    } else if (message.id == "downloadedBookList") {
        var xml = message.parameters[0];
        if (xml === undefined || xml === "") {
            dump("Unable to download the Metalink...\n");
        } else {
            /* Backup the 'old' number of available books */
            var oldRemoteBookCount = library.getRemoteBookCount();

            /* Load the remote library xml in content manager */
            library.readFromText(xml, false);
        }

        /* Get count of local&remote books */
        var localBookCount = library.getLocalBookCount();
        var remoteBookCount = library.getRemoteBookCount();

        /* Populate the book list ? */
        var doPopulateRemoteBookList = message.parameters[1];
        if (doPopulateRemoteBookList) {
            populateRemoteBookList();
        }

        /* If no local content but remote, change the default view */
        if (localBookCount === 0 && remoteBookCount > 0)
            selectLibraryMenu("library-menuitem-remote");

        /* New content are available online */
        if (oldRemoteBookCount < remoteBookCount) {

            /* Save library (library.xml in the user profile) */
            library.writeToFile();

            /* First start - online */
            if (oldRemoteBookCount === 0) {
                if (displayConfirmDialog(getProperty("newContentAvailableInvitation"))) {
                    showRemoteBooks();
                }
            }

            /* New content released online */
            else {
                sendNotification(getProperty("information"), getProperty("newContentAvailable"));
            }
        }
    }
};

downloader.onerror = function(message) {};

function addMetalink(id, metalinkContent) {
    /* Make a cache if necessary */
    if (!isFile(appendToPath(settings.getRootPath(), id + ".meta4"))) {
        writeFile(appendToPath(settings.getRootPath(), id + ".meta4"), metalinkContent);
    }

    /* Tell aria2c to start the download */
    var param = new xmlrpcval(metalinkContent, "base64");
    var msg = new xmlrpcmsg("aria2.addMetalink", [param]);
    var response = aria2Client.send(msg);

    /* If aria2c not running then exception */
    try {
        var gid = response.val.arrayMem(0).scalarVal();
        /* set the gid */
        settings.setDownloadProperty(id, "gid", gid);
    } catch (error) {}
}

function addUri(id, uri) {
    /* Tell aria2c to start the download */
    var xmlrpcvalue = new xmlrpcval(uri, "string");
    var arr = [xmlrpcvalue];
    var param = new xmlrpcval(arr, 'array');
    var msg = new xmlrpcmsg("aria2.addUri", [param]);
    var response = aria2Client.send(msg);

    /* If aria2c not running then exception */
    try {
        var gid = response.val.arrayMem(0);
        settings.setDownloadProperty(id, "gid", gid);
    } catch (error) {}
}

function isDownloaderRunning() {
    var timestamp = Number(new Date());
    if (timestamp > _isDownloaderRunningTimestamp + 1000) {
        var contentManager = Components.classes["@kiwix.org/contentManager"].getService().
        QueryInterface(Components.interfaces.IContentManager);
        _isDownloaderRunning = contentManager.isAria2cRunning();
        _isDownloaderRunningTimestamp = timestamp;
    }
    return _isDownloaderRunning;
}

function checkDownloader() {
    if (isDownloaderRunning() && !downloadsResumed && library.getRemoteBookCount() > 0) {
        resumeDownloads();
    }
}

function startDownloader() {
    /* Get the aria2c binary whole path */
    var binaryPath = whereis(env.isWindows() ? "aria2c.exe" : "aria2c");
    if (binaryPath === undefined) {
        dump("Unable to find the aria2c binary.\n");
        return;
    }

    /* Start the aria2c binary */
    var contentManager = Components.classes["@kiwix.org/contentManager"].getService().
    QueryInterface(Components.interfaces.IContentManager);
    if (!contentManager.launchAria2c(binaryPath, getDownloadPath(), getDownloaderLogPath())) {
        dump("Unable to launch the aria2c binary.\n");
    }
}

function stopDownloader() {
    var contentManager = Components.classes["@kiwix.org/contentManager"].getService().
    QueryInterface(Components.interfaces.IContentManager);
    contentManager.killAria2c();
}

function getAriaDownloadStatus(gid) {
    var param1 = new xmlrpcval(gid, "base64");
    var param2 = new xmlrpcval("gid", "base64");
    var param3 = new xmlrpcval("status", "base64");
    var arr = [param2, param3];
    var param4 = new xmlrpcval(arr, 'array');
    var msg = new xmlrpcmsg("aria2.tellStatus", [param1, param4]);
    var response = aria2Client.send(msg);
    return (response.val != 0 ? response.val.structMem('status').scalarVal() : "");
}

function getAriaDownloadPath(gid) {
    var param = new xmlrpcval(gid, "base64");
    var msg = new xmlrpcmsg("aria2.getFiles", [param]);
    var response = aria2Client.send(msg);
    var path = (response.val != 0 ? response.val.arrayMem(0).structMem('path').scalarVal() : "");

    /* There is a bug on certain version of aria2c by the concatenating of path */
    if (env.isWindows()) {
        path = path.replace(/\//g, '\\');
    }

    return path;
}

function isMetalinkUrl(url) {
    var metalinkUrlRegexp = new RegExp("^.*\.(metalink|meta4)$", "");
    return metalinkUrlRegexp.test(url);
}

function startDownload(url, id) {
    if (isMetalinkUrl(url)) {
        if (isFile(appendToPath(settings.getRootPath(), id + ".meta4"))) {
            addMetalink(id, readFile(appendToPath(settings.getRootPath(), id + ".meta4")));
        } else {
            var message = new WorkerMessage("downloadMetalink", [url], [id]);
            downloader.postMessage(message);
        }
    } else {
        addUri(id, url);
    }
}

function stopDownload(index) {
    var param = new xmlrpcval(index, "base64");
    var msg = new xmlrpcmsg("aria2.remove", [param]);
    var response = aria2Client.send(msg);
}

function pauseDownload(index) {
    var param = new xmlrpcval(index, "base64");
    var msg = new xmlrpcmsg("aria2.pause", [param]);
    var response = aria2Client.send(msg);
}

function resumeDownload(index) {
    var param = new xmlrpcval(index, "base64");
    var msg = new xmlrpcmsg("aria2.unpause", [param]);
    var response = aria2Client.send(msg);
}

function moveDownloadPositionToTop(index) {
    var param1 = new xmlrpcval(index, "base64");
    var param2 = new xmlrpcval(0, "base64");
    var param3 = new xmlrpcval("POS_SET", "base64");
    var msg = new xmlrpcmsg("aria2.changePosition", [param1, param2, param3]);
    var response = aria2Client.send(msg);
}

function removeDownload(index) {
    var param = new xmlrpcval(index, "base64");
    var msg = new xmlrpcmsg("aria2.remove", [param]);
    var response = aria2Client.send(msg);
}

function getDownloadStatus() {
    /* Get Kiwix list of downloads */
    var kiwixDownloadsString = settings.downloads();
    var kiwixDownloads = settings.unserializeDownloads(kiwixDownloadsString);
    var kiwixDownloadsCount = kiwixDownloads.length;

    /* Get aria2 active downloads */
    var ariaRunning = isDownloaderRunning();
    var ariaDownloadsCount = 0;
    var ariaResponse;
    if (kiwixDownloadsCount > 0 && ariaRunning) {
        var ariaMessage = new xmlrpcmsg("aria2.tellActive");
        ariaResponse = aria2Client.send(ariaMessage);
        if (typeof ariaResponse.val == "object") {
            ariaDownloadsCount = ariaResponse.val.arraySize();
        }
    }

    /* Get through all known downloads */
    for (var i = 0; i < kiwixDownloadsCount; i++) {
        var kiwixDownload = kiwixDownloads[i];
        var book = library.getBookById(kiwixDownload.id);
        var box = document.getElementById("library-content-item-" + book.id);

        /* In case of a ZIM file where open and at the same time already downloading */
        if (book.path != "") {
            manageStopDownload(book.id);
        }

        /* Download is running */
        if (kiwixDownload.status == 1) {
            /* Find the corresponding ariaDownload */
            var ariaDownload = undefined;
            for (var j = 0; j < ariaDownloadsCount; j++) {
                var currentAriaDownload = ariaResponse.val.arrayMem(j);
                var ariaDownloadGid = currentAriaDownload.structMem('gid').scalarVal();
                var ariaDownloadBelongsTo = currentAriaDownload.structMem('belongsTo') != undefined ?
                    currentAriaDownload.structMem('belongsTo').scalarVal() : ariaDownloadGid;

                if (ariaDownloadGid == kiwixDownload.gid) {
                    if (ariaDownloadBelongsTo != ariaDownloadGid) {
                        settings.setDownloadProperty(kiwixDownload.id, "gid", ariaDownloadBelongsTo);
                    } else {
                        ariaDownload = currentAriaDownload;
                    }
                }
            }

            if (ariaDownload !== undefined) {
                /* Retrieve infos */
                var ariaDownloadSpeed = ariaDownload.structMem('downloadSpeed').scalarVal();
                var ariaDownloadCompleted = ariaDownload.structMem('completedLength').scalarVal();

                /* Update download status lebel */
                var downloadStatusLabel = document.getElementById("download-status-label-" + book.id);
                var downloadStatusLabelString = getProperty("preparingContentDownload");

                /* Download started */
                if (ariaDownloadCompleted > 0 || ariaDownloadSpeed > 0) {

                    /* Update the settings */
                    settings.setDownloadProperty(kiwixDownload.id, "completed", ariaDownloadCompleted);

                    /* Compute the remaining time */
                    var remaining = (book.size * 1024 - ariaDownloadCompleted) / ariaDownloadSpeed;
                    var remainingHours = (remaining >= 3600 ? parseInt(remaining / 3600) : 0);
                    remaining = parseInt(remaining - (remainingHours * 3600));
                    var remainingMinutes = (remaining >= 60 ? parseInt(remaining / 60) : 0);
                    remaining = parseInt(remaining - (remainingMinutes * 60));

                    /* Update the download status string */
                    downloadStatusLabelString = (remainingHours > 0 || remainingMinutes > 0 || remaining > 0 ? "Time remaining: " : "") + (remainingHours > 0 ? remainingHours + " hours" : "") + (remainingHours > 0 && remainingMinutes > 0 ? ", " : "") + (remainingMinutes > 0 ? remainingMinutes + " minutes" : "") + (remainingHours == 0 && remainingMinutes > 0 && remaining > 0 ? ", " : "") + (remainingHours == 0 && remaining > 0 ? remaining + " seconds" : "") + (remainingHours > 0 || remainingMinutes > 0 || remaining > 0 ? " – " : "") + formatFileSize(ariaDownloadCompleted) + " of " + formatFileSize(book.size * 1024) + (ariaDownloadSpeed !== undefined && ariaDownloadSpeed > 0 ? " (" + formatFileSize(ariaDownloadSpeed) + "/s)" : "");
                }
                downloadStatusLabel.setAttribute("value", downloadStatusLabelString);
            } else {
                var ariaDownloadStatus = getAriaDownloadStatus(kiwixDownload.gid);
                if (ariaDownloadStatus == "complete") {
                    var ariaDownloadPath = getAriaDownloadPath(kiwixDownload.gid);
                    ariaDownloadPath = ariaDownloadPath.replace(/\\/g, "\\\\"); /* Necessary to avoid escaping */
                    library.setBookPath(kiwixDownload.id, ariaDownloadPath);
                    populateLocalBookList();
                    populateRemoteBookList();
                    settings.setDownloadProperty(kiwixDownload.id, "id", "");
                    removeDownload(kiwixDownload.gid);
                    cleanDownloadTemporaryFiles(book.id);

                    /* Show the notifications */
                    var callback = function(subject, topic, data) {
                        if (topic == "alertfinished")
                            sendNotification(getProperty("feedback"), "Help us! Why did you download '" + book.title + "'?",
                                "http://input.kiwix.org/whycontent.html?version=" + book.url);
                    };
                    sendNotification(getProperty("information"), getProperty("contentDownloadFinished", book.title),
                        undefined, callback);

                    /* Try to open the new file */
                    book = library.getBookById(kiwixDownload.id);
                    if (displayConfirmDialog(getProperty("openContentConfirm", book.title))) {
                        manageOpenFile(book.path);
                    }
                } else if (ariaDownloadStatus == "waiting") {}
            }
        }

        /* Download is paused */
        var downloadStatusLabel = document.getElementById("download-status-label-" + kiwixDownload.id);
        var playButton = document.getElementById("play-button-" + kiwixDownload.id);
        var pauseButton = document.getElementById("pause-button-" + kiwixDownload.id);
        if (downloadStatusLabel !== undefined && kiwixDownload.status == 0 && kiwixDownload.completed > 1) {
            downloadStatusLabel.setAttribute("value", "Paused – " + formatFileSize(kiwixDownload.completed) + " of " + formatFileSize(book.size * 1024));
            playButton.setAttribute("style", "display: block;");
            pauseButton.setAttribute("style", "display: none;");
        } else {
            playButton.setAttribute("style", "display: none;");
            pauseButton.setAttribute("style", "display: block;");
        }

        /* Set the progressbar */
        var progressbar = document.getElementById("progressbar-" + book.id);
        if (progressbar !== undefined) {
            var progressbarValue = 0;
            if (kiwixDownload.completed !== undefined && kiwixDownload.completed != "0" && kiwixDownload.completed != "")
                progressbarValue = kiwixDownload.completed / (book.size * 1024) * 100;
            progressbar.setAttribute("value", progressbarValue);
        }
    }
}

/* Return the tmp directory path where the search index is build */
function getDownloaderLogPath() {
    return appendToPath(settings.getRootPath(), "downloader.log");
}

function getDownloadPath() {
    var dir = appendToPath(settings.dataDirectory());
    return appendToPath(dir, "content");
}

function formatNumber(number, decimals, dec_point, thousands_sep) {
    var n = number,
        c = isNaN(decimals = Math.abs(decimals)) ? 2 : decimals;
    var d = dec_point === undefined ? "," : dec_point;
    var t = thousands_sep === undefined ? "." : thousands_sep,
        s = n < 0 ? "-" : "";
    var i = parseInt(n = Math.abs(+n || 0).toFixed(c)) + "",
        j = (j = i.length) > 3 ? j % 3 : 0;
    return s + (j ? i.substr(0, j) + t : "") + i.substr(j).replace(/(\d{3})(?=\d)/g, "$1" + t) + (c ? d + Math.abs(n - i).toFixed(c).slice(2) : "");
}

function formatFileSize(filesize) {
    if (filesize >= 1073741824) {
        filesize = formatNumber(filesize / 1073741824, 2, '.', '') + ' GB';
    } else if (filesize >= 1048576) {
        filesize = formatNumber(filesize / 1048576, 2, '.', '') + ' MB';
    } else if (filesize >= 1024) {
        filesize = formatNumber(filesize / 1024, 0) + ' KB';
    } else {
        filesize = formatNumber(filesize, 0) + ' bytes';
    }

    return filesize;
};

function manageRemoveContent(id) {
    var keepContent = new Object();
    if (displayConfirmDialogEx(getProperty("removeContentConfirm"),
            undefined, getProperty("dontDeleteContentFiles"), keepContent)) {
        keepContent = keepContent.value;
        var book = library.getBookById(id);

        if (library.getCurrentId() == id) {
            manageUnload(true, true);
        }

        if (book !== undefined) {

            /* Delete content (zim/epub) file */
            if (!keepContent)
                deleteFile(book.path);

            /* Delete related fulltext search index files */
            deleteFile(book.indexPath);

            /* Remove paths information in the library */
            if (book.url != "") {
                library.setBookPath(id, "");
                library.setBookIndex(id, "");
            } else {
                library.deleteBookById(id);
            }

            /* Update the user interface */
            populateLocalBookList();
            populateRemoteBookList();
        }
    }
};

function manageStopDownload(id) {
    if (displayConfirmDialog("Are you sure you want to stop this download?")) {
        configureLibraryContentItemVisuals(id, "online");

        /* Get corresponding gid */
        var gid = settings.getDownloadProperty(id, "gid");

        /* Stop the download */
        stopDownload(gid);

        /* Delete file */
        var path = getAriaDownloadPath(gid);
        deleteFile(path);

        /* Clean temporary files */
        cleanDownloadTemporaryFiles(id);

        /* Remove Kiwix download */
        settings.setDownloadProperty(id, "id", "");
    }
}

function cleanDownloadTemporaryFiles(id) {
    var gid = settings.getDownloadProperty(id, "gid");
    var path = getAriaDownloadPath(gid);
    deleteFile(path + ".aria2");
    deleteFile(appendToPath(settings.getRootPath(), id + ".meta4"));
    deleteFile(appendToPath(settings.getRootPath(), id + ".metalink"));
}

function configureLibraryContentItemVisuals(id, mode) {
    if (mode == "download") {
        var downloadButton = document.getElementById("download-button-" + id);
        downloadButton.setAttribute("style", "display: none;");
        var loadButton = document.getElementById("load-button-" + id);
        loadButton.setAttribute("style", "display: none;");
        var removeButton = document.getElementById("remove-button-" + id);
        removeButton.setAttribute("style", "display: none;");
        var playButton = document.getElementById("play-button-" + id);
        playButton.setAttribute("style", "display: none;");
        var pauseButton = document.getElementById("pause-button-" + id);
        pauseButton.setAttribute("style", "display: none;");
        var downloadStatusLabel = document.getElementById("download-status-label-" + id);
        downloadStatusLabel.setAttribute("value", getProperty("preparingContentDownload"));
        var detailsDeck = document.getElementById("download-deck-" + id);
        detailsDeck.setAttribute("selectedIndex", "1");
    } else if (mode == "online") {
        var downloadButton = document.getElementById("download-button-" + id);
        downloadButton.setAttribute("style", "display: block;");
        var detailsDeck = document.getElementById("download-deck-" + id);
        detailsDeck.setAttribute("selectedIndex", "0");
        var loadButton = document.getElementById("load-button-" + id);
        loadButton.setAttribute("style", "display: none;");
        var removeButton = document.getElementById("remove-button-" + id);
        removeButton.setAttribute("style", "display: none;");
    } else if (mode == "offline") {
        var downloadButton = document.getElementById("download-button-" + id);
        downloadButton.setAttribute("style", "display: none;");
        var detailsDeck = document.getElementById("download-deck-" + id);
        detailsDeck.setAttribute("selectedIndex", "0");
        var loadButton = document.getElementById("load-button-" + id);
        loadButton.setAttribute("style", "display: block;");
        var removeButton = document.getElementById("remove-button-" + id);
        removeButton.setAttribute("style", "display: block;");
    }
}

function manageStartDownload(id, completed) {
    settings.addDownload(id);
    configureLibraryContentItemVisuals(id, "download");

    var book = library.getBookById(id);
    var progressbar = document.getElementById("progressbar-" + id);
    if (completed !== undefined && completed != "0" && completed != "") {
        var percent = completed / (book.size * 1024) * 100;
        progressbar.setAttribute("value", percent);
    } else {
        progressbar.setAttribute("value", 0);
    }

    startDownload(book.url, book.id);
}

function manageResumeDownload(id) {
    /* User Interface update */
    var pauseButton = document.getElementById("pause-button-" + id);
    pauseButton.setAttribute("style", "display: block;");
    var playButton = document.getElementById("play-button-" + id);
    playButton.setAttribute("style", "display: none;");

    /* Search the corresponding kiwix download */
    settings.setDownloadProperty(id, "status", "1");
    var gid = settings.getDownloadProperty(id, "gid");

    /* Resume the download */
    if (gid !== undefined) {
        var downloadStatusLabel = document.getElementById("download-status-label-" + id);
        downloadStatusLabel.setAttribute("value", "Resuming download...");

        if (getAriaDownloadStatus(gid) == "paused") {
            resumeDownload(gid);
        } else {
            var book = library.getBookById(id);
            startDownload(book.url, book.id);
        }
    }
}

function managePauseDownload(id) {
    /* User Interface update */
    var pauseButton = document.getElementById("pause-button-" + id);
    pauseButton.setAttribute("style", "display: none;");
    var playButton = document.getElementById("play-button-" + id);
    playButton.setAttribute("style", "display: block;");
    var downloadButton = document.getElementById("download-button-" + id);
    downloadButton.setAttribute("style", "display: none;");
    var detailsDeck = document.getElementById("download-deck-" + id);
    detailsDeck.setAttribute("selectedIndex", "1");

    /* Search the corresponding kiwix download */
    settings.setDownloadProperty(id, "status", "0");
    var gid = settings.getDownloadProperty(id, "gid");

    /* Pause the download */
    pauseDownload(gid);
}

function createLibraryItem(book) {
    var spacer = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "spacer");
    spacer.setAttribute("flex", "1");

    /* Create item box */
    var box = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "richlistitem");
    box.setAttribute("class", "library-content-item");
    box.setAttribute("id", "library-content-item-" + book.id);
    box.setAttribute("bookId", book.id);
    box.setAttribute("onclick", "selectLibraryContentItem(this);");

    var hbox = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "hbox");
    hbox.setAttribute("flex", "1");
    box.appendChild(hbox);

    var faviconBox = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "box");
    faviconBox.setAttribute("class", "library-content-item-favicon");
    if (book.favicon != "")
        faviconBox.setAttribute("style", "background-image: " + book.favicon);
    hbox.appendChild(faviconBox);

    var detailsBox = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "vbox");
    detailsBox.setAttribute("flex", "1");
    detailsBox.setAttribute("class", "library-content-item-details");
    hbox.appendChild(detailsBox);

    var titleLabel = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "textbox");
    titleLabel.setAttribute("class", "library-content-item-title");
    titleLabel.setAttribute("readonly", true);
    titleLabel.setAttribute("size", 100);
    titleLabel.setAttribute("value", book.title || book.path);

    detailsBox.appendChild(titleLabel);

    var description = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "textbox");
    description.setAttribute("class", "library-content-item-description");
    description.setAttribute("readonly", true);
    description.setAttribute("size", 100);
    description.setAttribute("value", book.description);
    detailsBox.appendChild(description);

    var grid = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "grid");
    var columns = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "columns");

    var leftColumn = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "column");
    leftColumn.setAttribute("flex", "1");
    leftColumn.setAttribute("style", "min-width: 300px");

    var sizeLabel = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "label");
    sizeLabel.setAttribute("class", "library-content-item-detail");
    sizeLabel.setAttribute("value", "Size: " + formatFileSize(book.size * 1024) + " (" + formatNumber(book.articleCount, 0, '', '.') + " articles, " + formatNumber(book.mediaCount, 0, '', '.') + " medias)");
    leftColumn.appendChild(sizeLabel);

    var creatorLabel = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "label");
    creatorLabel.setAttribute("class", "library-content-item-detail");
    creatorLabel.setAttribute("value", "Author: " + book.creator);
    leftColumn.appendChild(creatorLabel);

    var publisherLabel = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "label");
    publisherLabel.setAttribute("class", "library-content-item-detail");
    publisherLabel.setAttribute("value", "Publisher: " + book.publisher);
    leftColumn.appendChild(publisherLabel);

    columns.appendChild(leftColumn);

    var rightColumn = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "column");
    rightColumn.setAttribute("flex", "2");
    rightColumn.setAttribute("style", "min-width: 200px");

    var dateLabel = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "label");
    dateLabel.setAttribute("class", "library-content-item-detail");
    dateLabel.setAttribute("value", "Created: " + book.date);
    rightColumn.appendChild(dateLabel);

    var languageLabel = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "label");
    languageLabel.setAttribute("class", "library-content-item-detail");
    languageLabel.setAttribute("value", "Language: " + (getLanguageNameFromISOCodes(book.language) || book.language));
    rightColumn.appendChild(languageLabel);

    columns.appendChild(rightColumn);
    grid.appendChild(columns);

    var detailsDeck = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "deck");
    detailsDeck.setAttribute("selectedIndex", "0");
    detailsDeck.setAttribute("id", "download-deck-" + book.id);
    detailsDeck.appendChild(grid);

    var downloadBox = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "vbox");

    var progressmeterBox = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "hbox");
    var progressmeter = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "progressmeter");
    progressmeter.setAttribute("flex", "1");
    progressmeter.setAttribute("id", "progressbar-" + book.id);
    progressmeterBox.appendChild(progressmeter);
    downloadBox.appendChild(progressmeterBox);

    var pauseButton = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "button");
    pauseButton.setAttribute("id", "pause-button-" + book.id);
    pauseButton.setAttribute("class", "pause mini-button");
    pauseButton.setAttribute("tooltiptext", "Pause download");
    pauseButton.setAttribute("onclick", "event.stopPropagation(); managePauseDownload('" + book.id + "')");
    progressmeterBox.appendChild(pauseButton);

    var playButton = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "button");
    playButton.setAttribute("id", "play-button-" + book.id);
    playButton.setAttribute("class", "play mini-button");
    playButton.setAttribute("tooltiptext", "Resume download");
    playButton.setAttribute("onclick", "event.stopPropagation(); manageResumeDownload('" + book.id + "')");
    progressmeterBox.appendChild(playButton);

    var cancelButton = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "button");
    cancelButton.setAttribute("class", "cancel mini-button");
    cancelButton.setAttribute("tooltiptext", "Cancel download");
    cancelButton.setAttribute("onclick", "event.stopPropagation(); manageStopDownload('" + book.id + "')");
    progressmeterBox.appendChild(cancelButton);

    var downloadStatusLabel = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "label");
    downloadStatusLabel.setAttribute("id", "download-status-label-" + book.id);
    downloadStatusLabel.setAttribute("value", "download details...");
    downloadBox.appendChild(downloadStatusLabel);

    detailsDeck.appendChild(downloadBox);
    detailsBox.appendChild(detailsDeck);

    /* Button box */
    var buttonBox = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "vbox");
    buttonBox.appendChild(spacer.cloneNode(true));

    var removeButton = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "button");
    removeButton.setAttribute("label", "Remove");
    removeButton.setAttribute("id", "remove-button-" + book.id);
    removeButton.setAttribute("onclick", "event.stopPropagation(); manageRemoveContent('" + book.id + "')");
    buttonBox.appendChild(removeButton);

    var loadButton = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "button");
    loadButton.setAttribute("label", "Load");
    loadButton.setAttribute("id", "load-button-" + book.id);
    loadButton.setAttribute("onclick", "event.stopPropagation(); manageOpenFile('" + book.path.replace(/\\/g, '\\\\') + "')");
    buttonBox.appendChild(loadButton);

    var downloadButton = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "button");
    downloadButton.setAttribute("label", "Download");
    downloadButton.setAttribute("id", "download-button-" + book.id);
    downloadButton.setAttribute("onclick", "event.stopPropagation(); manageStartDownload('" + book.id + "')");
    buttonBox.appendChild(downloadButton);

    hbox.appendChild(buttonBox);
    return box
}

function populateBookList(container) {
    var book;
    var backgroundColor = "#FFFFFF";

    /* Autotection of the container if necessary */
    if (container === undefined) {
        container = getCurrentBookListContainer()
    }

    /* Remove the child nodes */
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    };

    /* Apply filter/sorting */
    var mode = container.id == "library-content-local" ? "local" : "remote";
    var sortBy = getBookListSortBy();
    var maxSize = getBookListContentMaxSize();
    var creator = getBookListCreatorFilter();
    var publisher = getBookListPublisherFilter();
    var language = getBookListLanguageFilter();
    var search = getBookListSearchFilter();

    library.listBooks(mode, sortBy, maxSize, language, creator, publisher, search);

    /* Go through all books */
    book = library.getNextBookInList();
    while (book !== undefined) {

        var box = createLibraryItem(book);
        box.setAttribute("style", "background-color: " + backgroundColor + ";");

        /* Add the new item to the UI */
        container.appendChild(box);

        if (book.path !== "") {
            configureLibraryContentItemVisuals(book.id, "offline");
        } else if (downloadStatus !== undefined) {
            var downloadStatus = settings.getDownloadProperty(book.id, "status");
            configureLibraryContentItemVisuals(book.id, "download");
        } else {
            configureLibraryContentItemVisuals(book.id, "online");
        }

        /* Compute new item background color */
        backgroundColor = (backgroundColor == "#FFFFFF" ? "#EEEEEE" : "#FFFFFF");
        book = library.getNextBookInList();
    }

    populateLibraryFilters();
}

function populateLocalBookList() {
    populateBookList(document.getElementById("library-content-local"));
}

function populateRemoteBookList() {
    populateBookList(document.getElementById("library-content-remote"));
}

function populateLibraryFilters() {
    var languageMenu = document.getElementById('library-filter-language');
    while (languageMenu.firstChild.childNodes.length > 1) {
        languageMenu.firstChild.removeChild(languageMenu.firstChild.lastChild);
    }
    var bookLanguageCodes = library.getBooksLanguages();
    var alreadyListedLanguages = new Array();

    for (var index = 0; index < bookLanguageCodes.length; index++) {
        var currentLanguageCode = bookLanguageCodes[index];

        if (currentLanguageCode) {
            var currentLanguage = getLanguageNameFromISOCodes(currentLanguageCode);
            var currentLanguageRegex = getLanguageRegex(currentLanguage);

            if (currentLanguage && alreadyListedLanguages[currentLanguageRegex] === undefined) {
                alreadyListedLanguages[currentLanguageRegex] = true;

                var menuItem = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
                    "menuitem");
                menuItem.setAttribute("value", currentLanguageRegex);
                menuItem.setAttribute("label", currentLanguage);
                languageMenu.firstChild.insertBefore(menuItem, languageMenu.firstChild.lastChild.nextSibling);
            }
        }
    }

    var creators = library.getBooksCreators();
    var creatorMenu = document.getElementById('library-filter-creator');
    while (creatorMenu.firstChild.childNodes.length > 1) {
        creatorMenu.firstChild.removeChild(creatorMenu.firstChild.lastChild);
    }

    var tmpHash = new Array();
    for (var index = 0; index < creators.length; index++) {
        if (creators[index].length > 0 && tmpHash[creators[index]] === undefined) {
            tmpHash[creators[index]] = 42;
            var menuItem = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
                "menuitem");
            menuItem.setAttribute("value", creators[index]);
            menuItem.setAttribute("label", creators[index]);
            creatorMenu.firstChild.insertBefore(menuItem, languageMenu.firstChild.lastChild.nextSibling);
        }
    }

    var publishers = library.getBooksPublishers();
    var publisherMenu = document.getElementById('library-filter-publisher');
    while (publisherMenu.firstChild.childNodes.length > 1) {
        publisherMenu.firstChild.removeChild(publisherMenu.firstChild.lastChild);
    }
    tmpHash = new Array();

    for (var index = 0; index < publishers.length; index++) {
        if (publishers[index].length > 0 && tmpHash[publishers[index]] === undefined) {
            tmpHash[publishers[index]] = 42;
            var menuItem = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
                "menuitem");
            menuItem.setAttribute("value", publishers[index]);
            menuItem.setAttribute("label", publishers[index]);
            publisherMenu.firstChild.insertBefore(menuItem, languageMenu.firstChild.lastChild.nextSibling);
        }
    }
}

function manageDownloadRemoteBookListCore() {
    if (_isOnline !== undefined) {
        clearInterval(updateOnlineStatusId);
        if (_isOnline == true) {
            var continueWithDownloading = settings.downloadRemoteCatalogs();

            /* If necesseray ask for permission to download the remote catalog */
            if (continueWithDownloading === undefined) {
                var doNotAskAnymore = new Object();
                doNotAskAnymore.value = true;

                continueWithDownloading = displayConfirmDialogEx(getProperty("downloadRemoteCatalogsConfirm"), getProperty("downloadRemoteCatalogs"), getProperty("doNotAskAnymore"), doNotAskAnymore);

                /* Save the autorisation to not ask each time */
                if (doNotAskAnymore.value == true) {
                    settings.downloadRemoteCatalogs(continueWithDownloading);
                }
            }

            /* Download the remote catalogs */
            if (continueWithDownloading) {
                downloadRemoteBookList(true, true);
            }
        }
    }
}

function manageDownloadRemoteBookList() {
    var continueWithDownloading = settings.downloadRemoteCatalogs();

    if (continueWithDownloading !== false) {
        updateOnlineStatusId = window.setInterval("manageDownloadRemoteBookListCore()", 1000);
        var message = new WorkerMessage("updateOnlineStatus");
        downloader.postMessage(message);
    }
}

function downloadRemoteBookList(populateRemoteBookList, resumeDownloads) {
    populateRemoteBookList = (populateRemoteBookList == undefined ? false : populateRemoteBookList);
    resumeDownloads = (resumeDownloads == undefined ? false : resumeDownloads);

    var libraryUrls = settings.libraryUrls().split(';');
    for (var index = 0; index < libraryUrls.length; index++) {
        var libraryUrl = libraryUrls[index];
        var message = new WorkerMessage("downloadBookList", [libraryUrl], [populateRemoteBookList, resumeDownloads]);
        downloader.postMessage(message);
    }
}

function isLibraryVisible() {
    var renderingDeck = document.getElementById("rendering-deck");
    return renderingDeck.selectedIndex == 1;
}

/* Show/hide library manager */
function toggleLibrary(visible) {
    var libraryButton = getLibraryButton();
    var renderingDeck = document.getElementById("rendering-deck");
    var newWindowTitle = getProperty("library") + " - Kiwix";
    var browseLibraryMenuItem = document.getElementById("file-browse-library");
    var hideLibraryMenuItem = document.getElementById("file-hide-library");
    var libraryPage = document.getElementById("library-page");

    if (visible === undefined) {
        visible = isLibraryVisible() ? false : true;
    } else if (visible == isLibraryVisible()) {
        return;
    }

    if (!visible) {
        /* Do not remove, insible decks still have side effects on visible ones */
        libraryPage.setAttribute("style", "display: none;");

        browseLibraryMenuItem.setAttribute("style", "display: visible;");
        hideLibraryMenuItem.setAttribute("style", "display: none;");
        libraryButton.setAttribute("tooltiptext", getProperty("browseLibrary"));
        activateHomeButton();
        activateZoomButtons();
        activateFullscreenButton();
        activateToolbarButton(getPrintButton());
        activateToolbarButton(getSearchInPlaceButton());
        activateToolbarButton(getBookmarksButton())
        libraryButton.setAttribute('checked', false);
        renderingDeck.selectedIndex = 0;
        activateGuiSearchComponents();
        updateGuiHistoryComponents();
        if (getWindow().getAttribute("title") == newWindowTitle)
            getWindow().setAttribute("title", _oldWindowTitle);
        if (settings.displayBookmarksBar()) {
            UIToggleBookmarksBar(true);
        }
    } else {
        /* Do not remove, insible decks still have side effects on visible ones */
        libraryPage.setAttribute("style", "display: visible;");

        browseLibraryMenuItem.setAttribute("style", "display: none;");
        hideLibraryMenuItem.setAttribute("style", "display: visible;");
        libraryButton.setAttribute("tooltiptext", getProperty("hideLibrary"));
        desactivateHomeButton();
        desactivateZoomButtons();
        desactivateFullscreenButton();
        desactivateToolbarButton(getPrintButton());
        desactivateToolbarButton(getSearchInPlaceButton());
        desactivateToolbarButton(getBookmarksButton())
        libraryButton.setAttribute('checked', true);
        renderingDeck.selectedIndex = 1;
        desactivateGuiSearchComponents();
        updateGuiHistoryComponents();
        _oldWindowTitle = getWindow().getAttribute("title");
        getWindow().setAttribute("title", newWindowTitle);

        /* Reinitialize the scrollbar - seems to be necessary */
        var libraryDeck = document.getElementById("library-deck");
        libraryDeck.selectedPanel.ensureIndexIsVisible(libraryDeck.selectedPanel.selectedIndex);

        UIToggleBookmarksBar(false, false);

        _libraryKeyCursorOnMenu = false;
    }
}

function resumeDownloads() {
    /* Erase gids */
    settings.eraseDownloadGids();

    /* Resume */
    var downloadsString = settings.downloads();
    var downloadsArray = settings.unserializeDownloads(downloadsString);
    for (var index = 0; index < downloadsArray.length; index++) {
        var download = downloadsArray[index];
        if (download.status == 1) {
            manageStartDownload(download.id, download.completed);
        } else {
            managePauseDownload(download.id);
        }
    }

    downloadsResumed = true;
}

function selectLibraryMenu(menuItemId) {
    var menuItemLocal = document.getElementById("library-menuitem-local");
    var menuItemRemote = document.getElementById("library-menuitem-remote");
    var libraryDeck = document.getElementById("library-deck");

    if (menuItemId == "library-menuitem-local") {
        menuItemLocal.setAttribute("class", "library-menuitem-selected");
        menuItemRemote.setAttribute("class", "library-menuitem-unselected");
        libraryDeck.selectedIndex = 0;
    } else {
        menuItemRemote.setAttribute("class", "library-menuitem-selected");
        menuItemLocal.setAttribute("class", "library-menuitem-unselected");
        libraryDeck.selectedIndex = 1;
    }
    populateBookList();
    selectLibraryContentItem(libraryDeck.selectedPanel.firstChild);
}

function selectLibraryContentItem(box) {
    if (box === undefined)
        return;

    if (_selectedLibraryContentItem !== undefined && box == _selectedLibraryContentItem)
        return;

    box.parentNode.selectedItem = box;
    _selectedLibraryContentItem = box;
    var libraryDeck = document.getElementById("library-deck");
    libraryDeck.selectedPanel.ensureIndexIsVisible(libraryDeck.selectedPanel.selectedIndex);
}

function startDownloadObserver() {
    checkDownloaderId = window.setInterval("checkDownloader()", 1000);
    checkDownloadStatusId = window.setInterval("getDownloadStatus()", 1000);
}

function stopDownloaderObserver() {
    clearInterval(checkDownloaderId);
    clearInterval(checkDownloadStatusId);
}

function showLocalBooks() {
    selectLibraryMenu("library-menuitem-local");
    toggleLibrary(true);
}

function showRemoteBooks() {
    selectLibraryMenu("library-menuitem-remote");
    toggleLibrary(true);
}

/* Populate the library */
function initLibrary() {
    if (!env.isSugar()) {
        try {
            populateLocalBookList();
            selectLibraryMenu("library-menuitem-local");
        } catch (e) {
            dump("Unable to populate Content Manager: " + e.toString() + "\n");
        }
    }
}

/* No download for Sugar */
function initDownloader() {

    if (!env.isSugar()) {
        startDownloader();
        startDownloadObserver();
    }
}

function getCurrentBookListContainer() {
    return document.getElementById("library-deck").selectedPanel;
}

function getBookListSortBy() {
    return document.getElementById("library-sortby").selectedItem.getAttribute("value");
}

function getBookListContentMaxSize() {
    return document.getElementById("library-content-maxsize").value;
}

function getBookListCreatorFilter() {
    return document.getElementById('library-filter-creator').value;
}

function getBookListPublisherFilter() {
    return document.getElementById('library-filter-publisher').value;
}

function getBookListLanguageFilter() {
    return document.getElementById('library-filter-language').value;
}

function getBookListSearchFilter() {
    return document.getElementById('library-filter-search').value;
}