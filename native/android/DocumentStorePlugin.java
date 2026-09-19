package com.lioryosub.pdftoolkit;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/**
 * Saving to a place the user picks.
 *
 * Android has no filesystem an app may write to freely, and no published
 * Capacitor plugin wraps the thing that replaces one. `@capacitor/filesystem`
 * refuses outright -- "'writeFile' not supported for content:// URIs" -- even
 * for a folder the user has explicitly granted, so without this the only way to
 * deliver a finished file is the share sheet.
 *
 * What it wraps is `ACTION_CREATE_DOCUMENT`: the system Save-as dialog. The user
 * chooses the folder and the filename, in any provider they have -- local
 * storage, Drive, anything else installed -- and the app gets back a URI it may
 * write to exactly once without ever seeing a path.
 *
 * Lives in `native/android/` rather than inside the generated `android/`
 * project, because that project is build output and is recreated by
 * `npx cap add android`. `scripts/build-android.mjs` copies it into place.
 */
@CapacitorPlugin(name = "DocumentStore")
public class DocumentStorePlugin extends Plugin {

    /** Opens the Save-as dialog. Resolves `{ cancelled: true }` if the user backs out. */
    @PluginMethod
    public void createDocument(PluginCall call) {
        String suggestedName = call.getString("suggestedName", "document.pdf");
        String mimeType = call.getString("mimeType", "application/pdf");

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, suggestedName);
        startActivityForResult(call, intent, "createDocumentResult");
    }

    @ActivityCallback
    private void createDocumentResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            // Backing out of a save dialog is an ordinary outcome, not a failure.
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        Uri uri = data.getData();
        persist(uri);
        ret.put("cancelled", false);
        ret.put("uri", uri.toString());
        ret.put("name", displayName(uri, call.getString("suggestedName", "document.pdf")));
        call.resolve(ret);
    }

    /**
     * Create a file inside a folder the user granted earlier with
     * ACTION_OPEN_DOCUMENT_TREE. Used when several files are written at once --
     * splitting a document -- where one dialog per file would be intolerable.
     */
    @PluginMethod
    public void createInTree(PluginCall call) {
        String treeUri = call.getString("treeUri");
        String name = call.getString("name");
        String mimeType = call.getString("mimeType", "application/pdf");
        if (treeUri == null || name == null) {
            call.reject("treeUri and name are required");
            return;
        }

        try {
            Uri tree = Uri.parse(treeUri);
            // A tree URI is not itself a document; the document id has to be
            // derived before anything can be created inside it.
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(
                    tree, DocumentsContract.getTreeDocumentId(tree));
            Uri created = DocumentsContract.createDocument(
                    getContext().getContentResolver(), parent, mimeType, name);
            if (created == null) {
                call.reject("could not create " + name + " in the chosen folder");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("uri", created.toString());
            ret.put("name", displayName(created, name));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), e);
        }
    }

    /** Write bytes into a URI this plugin returned. */
    @PluginMethod
    public void writeDocument(PluginCall call) {
        String uriString = call.getString("uri");
        String base64 = call.getString("data");
        if (uriString == null || base64 == null) {
            call.reject("uri and data are required");
            return;
        }

        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            // "wt" truncates. Without it, saving a smaller file over a larger
            // one leaves the tail of the old file behind, which for a PDF means
            // a corrupt document rather than an obviously wrong one.
            try (OutputStream out = getContext().getContentResolver()
                    .openOutputStream(Uri.parse(uriString), "wt")) {
                if (out == null) {
                    call.reject("could not open the chosen location for writing");
                    return;
                }
                out.write(bytes);
                out.flush();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), e);
        }
    }

    /** Keep the grant across restarts, so a later write is still permitted. */
    private void persist(Uri uri) {
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (SecurityException ignored) {
            // Some providers do not offer a persistable grant. The write in this
            // session still works, which is all a single save needs.
        }
    }

    /** What the provider calls the file, which is not derivable from the URI. */
    private String displayName(Uri uri, String fallback) {
        try (Cursor c = getContext().getContentResolver()
                .query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) {
                return c.getString(0);
            }
        } catch (Exception ignored) {
            // Fall through to the name we asked for.
        }
        return fallback;
    }
}
