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
var checkServerStatusId = undefined;

/* Display the preferences dialog box */
function showServerDialog() {
    var win = window.openDialog('server.xul', '', 'centerscreen,resizable=no,scrollbars=no,modal,dialog,chrome');
}

function getServerWindow() {
    return document.getElementById("server");
}

function updateServerDialog() {
    var serverManager = Components.classes["@kiwix.org/serverManager"].getService().
    QueryInterface(Components.interfaces.IServerManager);
    var isRunning = serverManager.isRunning();

    if (isRunning) {
        var url = new Object();
        serverManager.getServerUrl(url);
        document.getElementById("start-button").setAttribute("style", "display: none;");
        document.getElementById("stop-button").setAttribute("style", "display: block;");
        document.getElementById("status-description-label").value = "Server is running and available at:";
        document.getElementById("url-label-box").setAttribute("style", "visibility: display;");
        document.getElementById("url-label").value = url.value;
    } else {
        document.getElementById("stop-button").setAttribute("style", "display: none;");
        document.getElementById("start-button").setAttribute("style", "display: block;");
        document.getElementById("status-description-label").value = "Server is not running.";
        document.getElementById("url-label-box").setAttribute("style", "visibility: hidden;");
    }
}

function startServer() {
    var serverManager = Components.classes["@kiwix.org/serverManager"].getService().
    QueryInterface(Components.interfaces.IServerManager);
    var libraryPaths = library.paths + settings.customLibraryPaths();
    var port = document.getElementById("port-textbox").value;
    var binaryPath = whereis(env.isWindows() ? "kiwix-serve.exe" : "kiwix-serve");

    if (binaryPath === undefined) {
        displayErrorDialog("Unable to find the '" + (env.isWindows() ? "kiwix-serve.exe" : "kiwix-serve") + "' binary.");
    } else {
        serverManager.start(binaryPath, libraryPaths, port);
    }

    if (env.isMac()) {
        setTimeout(updateServerDialog, 2000);
    } else {
        updateServerDialog();
    }
}

function stopServer() {
    var serverManager = Components.classes["@kiwix.org/serverManager"].getService().
    QueryInterface(Components.interfaces.IServerManager);
    serverManager.stop();

    if (env.isMac()) {
        setTimeout(updateServerDialog, 2000);
    } else {
        updateServerDialog();
    }
}

function onServerDialogStart() {
    if (env.isMac()) {
        setTimeout(updateServerDialog, 2000);
    } else {
        updateServerDialog();
    }

    checkServerStatusId = window.setInterval("updateServerDialog()", 1000);
}

function onServerDialogQuit() {
    clearInterval(checkServerStatusId);
}