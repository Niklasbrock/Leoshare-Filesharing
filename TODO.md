# LeoLord File Sharing TODO Roadmap

## TODOs

### Fix: Preview landing when files are deleted/expired [PRIO: 1]
    When viewing any /preview/file link with no match in database, the user sees the default upload screen and is given no feedback. There should be a crash landing page for all /preview/X and /collection/X links with no match. So all invalid urls should go to a corresponding landing page, telling the user that it is an invalid link. Make sure there is no conflicts with other redirection logic. 

### Security Audit: Analize current security implementation
    There have been several security changes recently. Let's make sure that the entire system doesn't have any more security leaks. This server should be able to run from my home server, with a static IP network, without any security concerns. 

### New feature: Subscribe to files and collections [PRIO: 3]
    A button on the link preview which adds the file to the users list of files. These files should be in a new list below "Your Uploaded Files" called "Subscribed Files". Collections can also be subcribed to. 

### New feature: Swap file [PRIO: 3]
    A button on the "Your Uploaded Files" list to change the file, without changing anything else in the database. A sort of "hot-swap" feature, allowing for files to be replaced without breaking the database. This would allow for users who has saved a file, to get a new file on their list if the original uploader changes it.

### New feature: Password protected files [PRIO: 4]
    Have the option to add a password to files, which will then require that password to be input when the link is used. No password is needed on the file lists.

### Improvement: Live transcoding of video files [PRIO: 4]
    Find a GPU based algorithm for transcoding video files to a lower bitrate, for smoother streaming. 