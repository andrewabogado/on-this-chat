// background.js

chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_SIDEBAR' }).catch(err => {
            console.warn('Could not send message to tab. Is the content script loaded?', err);
            // Optional: Inject script if not present (requires scripting permission)
        });
    }
});
