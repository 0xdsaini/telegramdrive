/**
 * ChunkedDownloader.js
 * A utility for downloading large files from Telegram in chunks
 */

/**
 * Downloads a file from Telegram in chunks
 * @param {Object} telegramClient - The Telegram client instance
 * @param {string} fileId - The ID of the file to download
 * @param {number} fileSize - The total size of the file in bytes
 * @param {string} fileName - The name of the file being downloaded
 * @param {Function} progressCallback - Callback function to report download progress
 * @returns {Promise<Blob>} - A promise that resolves to a Blob containing the file data
 */
export const downloadFileInChunks = async (
  telegramClient,
  fileId,
  fileSize,
  fileName,
  progressCallback
) => {
  // Use smaller chunks for better progress reporting and to avoid memory issues
  const CHUNK_SIZE = 512 * 1024; // 512KB chunks
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  const chunks = [];
  let downloadedSize = 0;
  
  try {
    console.log(`Starting chunked download for ${fileName} (${fileSize} bytes) in ${totalChunks} chunks`);
    
    for (let i = 0; i < totalChunks; i++) {
      const offset = i * CHUNK_SIZE;
      const chunkSize = Math.min(CHUNK_SIZE, fileSize - offset);
      
      // Update progress
      const progress = Math.round((downloadedSize / fileSize) * 100);
      progressCallback(`Downloading ${fileName}... ${progress}%`);
      
      // Download chunk with retry mechanism
      let chunkResult = null;
      let chunkRetryCount = 0;
      const maxChunkRetries = 3;
      
      while (chunkRetryCount < maxChunkRetries) {
        try {
          chunkResult = await telegramClient.send({
            '@type': 'readFilePart',
            'file_id': fileId,
            'offset': offset,
            'count': chunkSize
          });
          
          if (chunkResult && chunkResult['@type'] !== 'error' && chunkResult.data) {
            break; // Success, exit retry loop
          }
          
          console.log(`Chunk ${i+1}/${totalChunks} retry ${chunkRetryCount + 1}/${maxChunkRetries} failed:`, chunkResult);
          chunkRetryCount++;
          
          // Wait before retrying with increasing delay
          await new Promise(resolve => setTimeout(resolve, 500 * (chunkRetryCount + 1)));
        } catch (chunkError) {
          console.error(`Chunk ${i+1}/${totalChunks} retry ${chunkRetryCount + 1}/${maxChunkRetries} error:`, chunkError);
          chunkRetryCount++;
          
          // Wait before retrying with increasing delay
          await new Promise(resolve => setTimeout(resolve, 500 * (chunkRetryCount + 1)));
        }
      }
      
      if (!chunkResult || chunkResult['@type'] === 'error' || !chunkResult.data) {
        throw new Error(`Failed to download chunk ${i+1}/${totalChunks}: ${chunkResult?.message || 'Unknown error'}`);
      }
      
      // Process chunk data
      let chunkData;
      if (typeof chunkResult.data === 'string') {
        // Handle base64 string
        try {
          const byteCharacters = atob(chunkResult.data);
          const byteArray = new Uint8Array(byteCharacters.length);
          for (let j = 0; j < byteCharacters.length; j++) {
            byteArray[j] = byteCharacters.charCodeAt(j);
          }
          chunkData = byteArray;
        } catch (error) {
          console.error('Error processing chunk data:', error);
          throw error;
        }
      } else if (chunkResult.data instanceof Uint8Array || chunkResult.data instanceof ArrayBuffer) {
        // Handle binary data
        chunkData = chunkResult.data;
      } else {
        throw new Error(`Unsupported chunk data format: ${typeof chunkResult.data}`);
      }
      
      chunks.push(chunkData);
      downloadedSize += chunkSize;
      
      // Small delay to prevent overwhelming the browser
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Final progress update
    progressCallback(`Downloading ${fileName}... 100%`);
    console.log(`Chunked download complete for ${fileName}. Total size: ${downloadedSize} bytes`);
    
    // Combine all chunks into a single blob
    return new Blob(chunks);
  } catch (error) {
    console.error('Error in chunked download:', error);
    throw error;
  }
};

/**
 * Determines the appropriate MIME type based on file extension
 * @param {string} fileName - The name of the file
 * @returns {string} - The MIME type
 */
export const getMimeTypeFromFileName = (fileName) => {
  // Default MIME type
  let mimeType = 'application/octet-stream';
  
  // Try to determine MIME type from file extension
  const extension = fileName.split('.').pop().toLowerCase();
  if (extension) {
    // Common MIME types mapping
    const mimeTypes = {
      'pdf': 'application/pdf',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'txt': 'text/plain',
      'html': 'text/html',
      'css': 'text/css',
      'js': 'text/javascript',
      'json': 'application/json',
      'xml': 'application/xml',
      'zip': 'application/zip',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'mp3': 'audio/mpeg',
      'mp4': 'video/mp4',
      'wav': 'audio/wav',
      'avi': 'video/x-msvideo',
      'mov': 'video/quicktime',
      'img': 'application/octet-stream'
    };
    
    if (mimeTypes[extension]) {
      mimeType = mimeTypes[extension];
    }
  }
  
  return mimeType;
};

/**
 * Creates and triggers a download for a blob
 * @param {Blob} blob - The blob to download
 * @param {string} fileName - The name to give the downloaded file
 */
export const triggerBlobDownload = (blob, fileName) => {
  const mimeType = getMimeTypeFromFileName(fileName);
  console.log(`Using MIME type: ${mimeType} for file: ${fileName}`);
  
  const url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
  
  // Create and trigger download link
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  
  // Use a small timeout to ensure the browser has time to create the object URL
  setTimeout(() => {
    link.click();
    document.body.removeChild(link);
    
    // Clean up the object URL after download starts
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 100);
};