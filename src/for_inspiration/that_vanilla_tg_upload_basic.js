<!DOCTYPE html>

<!-- Ref: This is the source of tdweb's index.js. Good to read this.-->
<!-- https://github.com/tdlib/td/blob/d2763fdd5887fc483d0b2bcdda30a6aa564d322a/example/web/tdweb/src/index.js -->

<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Upload to Telegram using TDLib (WebAssembly)</title>
</head>
<body>

    <h2>Telegram File Upload (User API)</h2>
    
    <input type="text" id="phone" placeholder="Enter phone number">
    <button onclick="sendCode()">Send Code</button>

    <input type="text" id="code" placeholder="Enter received code">
    <button onclick="login()">Login</button>

    <input type="file" id="fileInput">
    <button onclick="uploadFile()">Upload to Telegram</button>

    <!-- <input type="text" id="sendMessage" placeholder="Enter message to send">
    <button onclick="sendMessage()">Send Message</button>
 -->
    <script src="tdweb.js"></script>
    <script>

        let getChatsPromise;

        let cachedChats = loadChatsFromCache();

        async function initTDLib() {
            if (!window.tdweb || !window.tdweb.default) {
                console.error("❌ TDLib (tdweb) is not loaded correctly.");
                return;
            }

            window.TdClient = window.tdweb.default;

            try {
                window.tdClient = new TdClient({
                logVerbosityLevel: 1,
                jsLogVerbosityLevel: "info",
                mode: "wasm",
                api_id: 2899,  // Replace with your real API ID
                api_hash: "36722c72256a24c1225de00eb6a1ca74", // Replace with your real API Hash
            });
            tdClient.send({
                "@type": "setTdlibParameters",
                "use_test_dc": false,
                // "use_database": false, // From official repo: td@github/example/web/tdweb/src/index.js, line 41 -> [options.useDatabase=true] - Pass false to use TDLib without database and secret chats. It will significantly improve loading time, but some functionality will be unavailable.
                "database_directory": "/tdlib/dbfs",
                "files_directory": "/tdlib/inboundfs",
                "use_file_database": false,  // ⛔ Prevents storing files
                "use_chat_info_database": true,
                "use_message_database": true,
                "use_secret_chats": false,
                "api_id": 2899,  // Replace with your API ID
                "api_hash": "36722c72256a24c1225de00eb6a1ca74", // Replace with your API Hash
                "system_language_code": "en",
                "device_model": "Web",
                "system_version": "TDLib",
                "application_version": "1.0",
                "enable_storage_optimizer": true,
                "ignore_file_names": false,
                // "is_background": true // network/bandwidth saving mode. delays sending messages till the session is active. but since we don't have any logic of ending session in our code yet. using this would mean no message will ever be sent.
                // TODO: implement this mode(by some flush when sending message) if you want to save your users' bandwidth.
                "is_background": false // uses network as much is allowed
            }).then((result) => {
                console.log("✔️ setTdlibParameters Success:", result);
            }).catch((error) => {
                console.error("❌ setTdlibParameters Error:", error);
            });


                console.log("✅ TDLib Initialized:", tdClient);
            } catch (error) {
                console.error("❌ TDLib Initialization Failed:", error);
            }

            tdClient.onUpdate = function (update) {
                if (!update || !update["@type"]) return;

                // Filter only specific updates
                const allowedUpdates = [
                    // "updateFile",       // Track file uploads
                    // "updateMessageSendSucceeded",  // Track when a message is successfully sent
                    // "updateMessageSendFailed" // Track when a message fails to send
                ];

                if (allowedUpdates.includes(update["@type"])) {
                    console.log("🔄 TDLib Update:", update);
                }
            };

            // This is getting called when not logged-in as well. You may/may not
            // want to do something with that. Easier to ask for forgiveness than
            // permission maybe?

            // await waitForAuthorization();

            // calling getChat and getChats etc to load necessary data first
            // before we start doing our normal operations.
            await initializeData();


        //     window.tdClient.send({
        //         "@type": "checkDatabaseEncryptionKey",
        //         "encryption_key": ""  // Leave empty if you don’t want encryption
        //     }).then(() => {
        //         console.log("Database encryption key set successfully!");
        //     }).catch((err) => {
        //         console.error("Failed to set encryption key:", err);
        //     });
        } // initTdlib ends here

        async function initializeData() {

            console.log("Initializing data...");

            // Isko define karne me bhi time lag raha hai. 2-5 seconds to lagenge he
            // ab kya krna h iska. let's say upload file function call ho jaye
            // iske define hone se phle he. whole purpose of checking promise is
            // before doing anything is defeated na.
            // user's upload file will fail for 4-5 seconds and then after 4-5 seconds
            // later, it'll work... leaving the user confused.
            // doesn't give seamless/predictable/reliable behaviour to user.
            // TODO: do something about it.
            getChatsPromise = new Promise(async (resolve, reject) => {

            try {
                let response = await tdClient.send({
                    "@type": "getChat",
                    "chat_id": -4744438579, // Replace with your chat ID
                })
                console.log("getChat succeded: ", response);
                resolve(true); // resolve in below is like resolve(chatData);
            } catch (error) {
                console.log("getChat failed, error:", error);

                // We shouldn't be using delay's. probably, check for some 'readyauthorized' condition
                // in tdweb API before sending getChats query to server. because without that, it gives
                // chat list not found error basically my authorization process has not finished yet and
                // I'm not ready to send any getChats or any queries to server.

                console.log("delay starts now:");
                await delay(5000);
                console.log("after delay finishes");
                    try {
                        const chatData = await tdClient.send({
                            "@type": "getChats",
                            "limit": 2000 // Adjust as needed
                        });
                        console.log("✅ All Chats fetched:", chatData);
                        resolve(chatData); // Resolve the promise when done
                    } catch (error) {
                        console.error("❌ Error fetching chats:", error);
                        reject(error);
                    }
                }

                console.log("Initializing data...finished");

            });
            console.log("after defining getChatsPromise")

        }

        // async function checkAuthorizationState() {
        //     const state = await tdClient.send({ "@type": "getAuthorizationState" });
        //     console.log("🔍 Authorization State:", state);

        //     if (state["@type"] === "authorizationStateWaitTdlibParameters") {
        //         console.log("📌 Setting TDLib Parameters...");

        //         await tdClient.send({
        //             "@type": "setTdlibParameters",
        //             "use_test_dc": false,
        //             "database_directory": "",
        //             "files_directory": "",
        //             "use_file_database": false,
        //             "use_chat_info_database": false,
        //             "use_message_database": false,
        //             "use_secret_chats": false,
        //             "api_id": 2899,   // 🔹 Replace with your API ID
        //             "api_hash": "36722c72256a24c1225de00eb6a1ca74", // 🔹 Replace with your API Hash
        //             "system_language_code": "en",
        //             "device_model": "Web",
        //             "application_version": "1.0",
        //             "enable_storage_optimizer": true,
        //             "ignore_file_names": true
        //         });

        //         console.log("✅ TDLib Parameters Set!");
        //         setTimeout(checkAuthorizationState, 500); // Check state again
        //     } 
        //     else if (state["@type"] === "authorizationStateWaitPhoneNumber") {
        //         alert("Enter your phone number to log in.");
        //     } 
        //     else if (state["@type"] === "authorizationStateReady") {
        //         alert("Already logged in!");
        //     }
        // }

        function delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        function saveChatsToCache(data) {
            localStorage.setItem("cachedChats", JSON.stringify(data));
        }

        function loadChatsFromCache() {
            const data = localStorage.getItem("cachedChats");
            return data ? JSON.parse(data) : null;
        }


        // call this before calling getChats. means we're ready to do stuff now.
        async function waitForAuthorization() {
            return new Promise((resolve, reject) => {
                function handleUpdate(update) {
                    if (update["@type"] === "updateAuthorizationState") {
                        const state = update.authorization_state["@type"];
                        console.log("🔄 TDLib Auth State:", state);
                        
                        if (state === "authorizationStateReady") {
                            tdClient.off("update", handleUpdate); // Stop listening
                            resolve(); // Continue execution
                        } else if (state === "authorizationStateClosed") {
                            reject(new Error("TDLib session closed"));
                        }
                    }
                }

                tdClient.on("update", handleUpdate);
            });
        }

        async function sendCode() {
            const phone = document.getElementById("phone").value;
            if (!phone) {
                alert("Enter a phone number first!");
                return;
            }

            try {
                await tdClient.send({
                    "@type": "setAuthenticationPhoneNumber",
                    "phone_number": phone
                });
                alert("Login code sent to Telegram!");
            } catch (error) {
                console.error("❌ Error sending code:", error);
            }
        }

        async function login() {
            const code = document.getElementById("code").value;
            if (!code) {
                alert("Enter the Telegram code!");
                return;
            }

            try {
                await tdClient.send({
                    "@type": "checkAuthenticationCode",
                    "code": code
                });

                await initializeData();

                alert("Logged in successfully!");
            } catch (error) {
                console.error("❌ Login Failed:", error);
            }
        }

        async function uploadFile() {
            const fileInput = document.getElementById("fileInput");
            if (!fileInput.files.length) {
                alert("Select a file first!");
                return;
            }

            const file = fileInput.files[0];

            if (file.size === 0) {
                alert("Cannot upload an empty file!");
                return;
            }

            try {
                console.log("📂 Uploading file:", file.name, "Size:", file.size);
                // tdClient.onUpdate = (update) => console.error("🔄 TDLib Update:", update);

                console.log("Awaiting getChatsPromise to finish")
                await getChatsPromise;
                console.log("getChatsPromisefinished")

                await tdClient.send({
                    "@type": "getChat",
                    "chat_id": -4744438579, // Replace with your chat ID
                }).then(console.log).catch(console.log);

                await tdClient.send({
                    "@type": "sendMessage",
                    "chat_id": -4744438579, // Replace with your chat ID
                    "input_message_content": {
                        "@type": "inputMessageText",
                        "text": {
                            "@type": "formattedText",
                            "text": "Sending a file..."
                        }
                    }
                }).then(console.log).catch(console.log);


                // 🔥 Upload the file using inputFileBlob
                const message = await tdClient.send({
                    "@type": "sendMessage",
                    "chat_id": -4744438579,  // ✅ Replace with the valid chat ID
                    "input_message_content": {
                        "@type": "inputMessageDocument",
                        "document": {
                            "@type": "inputFileBlob",
                            "data": file,
                            "name": file.name  // Optional, to keep the original filename. You can also change the name of file from here(if you want. though is not required. may be beneficial when someday you split the files).

                        }
                    }
                });


                // const message = await tdClient.send({
                //     "@type": "sendMessage",
                //     "chat_id": -4744438579,  // ✅ Ensure this is a valid integer chat ID
                //     "input_message_content": {
                //         "@type": "inputMessageDocument",
                //         "document": {
                //             "@type": "inputFileGenerated",
                //             "original_path": file.name,  // Required for naming
                //             "conversion": "",
                //             "expected_size": file.size
                //         }
                //     }
                // });

                await tdClient.send({
                    "@type": "sendMessage",
                    "chat_id": -4744438579, // Replace with your chat ID
                    "input_message_content": {
                        "@type": "inputMessageText",
                        "text": {
                            "@type": "formattedText",
                            "text": "File sent!"
                        }
                    }
                }).then(console.error).catch(console.error);

                console.error("✅ File Uploaded:");
                // console.error("✅ File Uploaded:", message);
                // alert("File uploaded successfully!", message);
            } catch (error) {
                console.error("❌ File upload failed:", error);
            }
        }




        window.onload = function () {
            setTimeout(initTDLib, 100); // Increase this value when hosted. 9MB for wasm alone. (but cached, if cached, won't take much time.). worker file is also in MBs
        };
    </script>
</body>
</html>
