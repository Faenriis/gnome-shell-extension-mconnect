/** share.js - A simple FileChooserDialog for sending files */

const Format = imports.format;
const Lang = imports.lang;
const System = imports.system;
const Gettext = imports.gettext.domain('gnome-shell-extension-mconnect');
const _ = Gettext.gettext;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Notify = imports.gi.Notify;

// Local Imports
function getPath() {
    // Diced from: https://github.com/optimisme/gjs-examples/
    let m = new RegExp("@(.+):\\d+").exec((new Error()).stack.split("\n")[1]);
    return Gio.File.new_for_path(m[1]).get_parent().get_path();
}

imports.searchPath.push(getPath());

const MConnect = imports.mconnect;
const KDEConnect = imports.kdeconnect;
const { initTranslations, Settings } = imports.lib;

var ServiceProvider = {
    MCONNECT: 0,
    KDECONNECT: 1
};

// Gettext
initTranslations();
String.prototype.format = Format.format;


/** A simple FileChooserDialog for sharing files */
var ShareDialog = new Lang.Class({
    Name: "ShareDialog",
    Extends: Gtk.FileChooserDialog,
    
    _init: function (application, name) {
        this.parent({
            title: _("Send files to %s").format(name),
            action: Gtk.FileChooserAction.OPEN,
            select_multiple: true,
            icon_name: "document-send",
            modal: true
        });
    
        this.add_button(_("Cancel"), Gtk.ResponseType.CANCEL);
        this.add_button(_("Send"), Gtk.ResponseType.OK);
        this.set_default_response(Gtk.ResponseType.OK);
        this.connect("delete-event", application.vfunc_shutdown);
    }
});


var Application = new Lang.Class({
    Name: "Application",
    Extends: Gio.Application,

    _init: function() {
        this.parent({
            application_id: 'org.gnome.shell.extensions.mconnect.share',
            flags: Gio.ApplicationFlags.FLAGS_NONE
        });
        
        let application_name = _("MConnect File Share");

        GLib.set_prgname(application_name);
        GLib.set_application_name(application_name);
        Notify.init("gnome-shell-extension-mconnect");
        
        //
        this._cmd = null;
        this._uris = null;
        this._id = null;
        
        // Options
        this.add_main_option(
            "device",
            "d".charCodeAt(0),
            GLib.OptionFlags.NONE,
            GLib.OptionArg.STRING,
            "Device ID",
            "<device-id>"
        );
        
        this.add_main_option(
            "share",
            "s".charCodeAt(0),
            GLib.OptionFlags.NONE,
            GLib.OptionArg.FILENAME_ARRAY,
            "Share a local (eg. file:///...) or remote uri with <device-id>",
            "<uri>"
        );
        
        this.add_main_option(
            "list-devices",
            "l".charCodeAt(0),
            GLib.OptionFlags.NONE,
            GLib.OptionArg.NONE,
            "List all devices",
            null
        );
        
        this.add_main_option(
            "list-available",
            "a".charCodeAt(0),
            GLib.OptionFlags.NONE,
            GLib.OptionArg.NONE,
            "List available (paired and reachable) devices",
            null
        );
        
        this.register(null);
    },
    
    share: function () {
        if (!this._uris.length) { return; }
        
        let found = false;
        
        for (let device of this.manager.devices.values()) {
            if (device.id === this._id && device.hasOwnProperty("share")) {
                for (let uri of this._uris) {
                    device.shareURI(uri.toString());
                    found = true;
                }
                
                this._notifyShare(device.name, this._uris.length)
            }
        }
        
        if (!found) { throw Error("no device or share not supported"); }
    },
    
    _notifyShare: function (deviceName, num) {
        // FIXME: this closes immediately after opening in the extension
        let note = new Notify.Notification({
            summary: deviceName,
            body: Gettext.ngettext("Sending %d file", "Sending %d files", num).format(num),
            icon_name: "send-to-symbolic"
        });
        
        note.show()
    },

    vfunc_startup: function() {
        this.parent();
        
        if (Settings.get_enum("service-provider") === ServiceProvider.MCONNECT) {
            this.manager = new MConnect.DeviceManager();
        } else {
            this.manager = new KDEConnect.DeviceManager();
        }
    },

    vfunc_activate: function() {
        if (this._cmd === "list-devices") {
            this.manager.scan("list-devices");
            GLib.usleep(2000000) // 2 seconds
            this.manager.scan("list-devices");
            
            let status;
            
            for (let device of this.manager.devices.values()) {
                if (device.reachable && device.trusted) {
                    status = " (paired and reachable)";
                } else if (device.reachable) {
                    status = " (reachable)";
                } else if (device.trusted) {
                    status = " (paired)";
                }
                
                print(device.name + ": " + device.id + status);
            }
        } else if (this._cmd === "list-available") {
            for (let device of this.manager.devices.values()) {
                if (device.reachable && device.trusted) {
                    print(device.name + ": " + device.id);
                }
            }
        } else if (this._cmd === "share" && this._id) {
            this.share();
        } else if (this._id) {
            Gtk.init(null);
            
            let name;
            
            for (device of this.manager.devices.values()) {
                if (device.id === this._id) {
                    name = device.name;
                }
            }
            
            let dialog = new ShareDialog(this, name);
            
            if (dialog.run() === Gtk.ResponseType.OK) {
                this._uris = dialog.get_uris();
            }
            
            dialog.destroy();
            
            this.share();
        } else {
            throw Error("no command given");
        }
    },

    vfunc_shutdown: function() {
        this.parent();
        
        this.manager.destroy();
        delete this.manager;
    },
    
    vfunc_handle_local_options: function(options) {
        if (options.contains("device")) {
            this._id = options.lookup_value("device", null).deep_unpack();
        }
        
        if (options.contains("list-devices")) {
            this._cmd = "list-devices";
        } else if (options.contains("list-available")) {
            this._cmd = "list-available";
        } else if (options.contains("share")) {
            this._cmd = "share";
            this._uris = options.lookup_value("share", null).deep_unpack();
        }
        
        return -1;
    }
});

(new Application()).run([System.programInvocationName].concat(ARGV));

