/**
 * ChunkedDownloader.js
 * A utility for downloading large files from Telegram in chunks
 */

/**
 * Downloads a file from Telegram in chunks with parallel downloading
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
  // Adjust chunk size based on file size for better performance
  // Smaller chunks for smaller files, larger chunks for larger files
  const getOptimalChunkSize = (size) => {
    if (size < 1024 * 1024) return 256 * 1024; // 256KB for files < 1MB
    if (size < 10 * 1024 * 1024) return 512 * 1024; // 512KB for files < 10MB
    return 1024 * 1024; // 1MB for larger files
  };

  const CHUNK_SIZE = getOptimalChunkSize(fileSize);
  const MAX_PARALLEL_DOWNLOADS = 3; // Maximum number of parallel download connections
  
  // Adjust parallel downloads based on file size and chunk size
  const PARALLEL_DOWNLOADS = Math.min(
    MAX_PARALLEL_DOWNLOADS, 
    Math.ceil(fileSize / CHUNK_SIZE), // Don't use more connections than chunks
    10 // Hard upper limit
  );
  
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  
  // Create an array to store all chunks, pre-allocate with null values
  const chunks = new Array(totalChunks).fill(null);
  
  // Track download progress
  let downloadedSize = 0;
  let completedChunks = 0;
  let failedChunks = [];
  let lastProgressUpdate = 0;
  
  try {
    console.log(`Starting optimized chunked download for ${fileName} (${fileSize} bytes) in ${totalChunks} chunks with ${PARALLEL_DOWNLOADS} parallel connections`);
    console.log(`Using chunk size: ${CHUNK_SIZE / 1024}KB`);
    
    // Create a function to process a single chunk download
    const downloadChunk = async (chunkIndex) => {
      const offset = chunkIndex * CHUNK_SIZE;
      const chunkSize = Math.min(CHUNK_SIZE, fileSize - offset);
      
      // Download chunk with improved retry mechanism
      let chunkResult = null;
      let chunkRetryCount = 0;
      const maxChunkRetries = 5; // Increased max retries
      
      while (chunkRetryCount < maxChunkRetries) {
        try {
          // Add timeout to prevent hanging requests
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), 30000); // 30 second timeout
          });
          
          const requestPromise = telegramClient.send({
            '@type': 'readFilePart',
            'file_id': fileId,
            'offset': offset,
            'count': chunkSize
          });
          
          // Race between the request and the timeout
          chunkResult = await Promise.race([requestPromise, timeoutPromise]);
          
          if (chunkResult && chunkResult['@type'] !== 'error' && chunkResult.data) {
            break; // Success, exit retry loop
          }
          
          console.log(`Chunk ${chunkIndex+1}/${totalChunks} retry ${chunkRetryCount + 1}/${maxChunkRetries} failed:`, 
            chunkResult?.message || 'No data received');
          chunkRetryCount++;
          
          // Wait before retrying with increasing delay and some randomness to avoid thundering herd
          const delay = 500 * (chunkRetryCount + 1) + Math.random() * 500;
          await new Promise(resolve => setTimeout(resolve, delay));
        } catch (chunkError) {
          console.error(`Chunk ${chunkIndex+1}/${totalChunks} retry ${chunkRetryCount + 1}/${maxChunkRetries} error:`, 
            chunkError.message || chunkError);
          chunkRetryCount++;
          
          // Wait before retrying with increasing delay and some randomness
          const delay = 1000 * (chunkRetryCount + 1) + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      // Handle failed chunk after all retries
      if (!chunkResult || chunkResult['@type'] === 'error' || !chunkResult.data) {
        failedChunks.push(chunkIndex);
        console.error(`Failed to download chunk ${chunkIndex+1}/${totalChunks} after ${maxChunkRetries} retries`);
        return { chunkIndex, success: false };
      }
      
      // Process chunk data with improved error handling
      let chunkData;
      try {
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
            console.error(`Error decoding base64 data for chunk ${chunkIndex+1}:`, error);
            throw error;
          }
        } else if (chunkResult.data instanceof Uint8Array) {
          chunkData = chunkResult.data;
        } else if (chunkResult.data instanceof ArrayBuffer) {
          chunkData = new Uint8Array(chunkResult.data);
        } else {
          throw new Error(`Unsupported chunk data format: ${typeof chunkResult.data}`);
        }
        
        // Store the chunk in its correct position
        chunks[chunkIndex] = chunkData;
        
        // Update progress atomically
        completedChunks++;
        downloadedSize += chunkSize;
        
        // Throttle progress updates to avoid excessive UI updates
        const now = Date.now();
        if (now - lastProgressUpdate > 200 || completedChunks === totalChunks) {
          const progress = Math.round((downloadedSize / fileSize) * 100);
          progressCallback(`Downloading ${fileName}... ${progress}%`);
          lastProgressUpdate = now;
        }
        
        console.log(`Chunk ${chunkIndex+1}/${totalChunks} downloaded. Progress: ${Math.round((completedChunks / totalChunks) * 100)}%. Completed chunks: ${completedChunks}/${totalChunks}`);
        
        return { chunkIndex, success: true };
      } catch (processingError) {
        console.error(`Error processing chunk ${chunkIndex+1}:`, processingError);
        failedChunks.push(chunkIndex);
        return { chunkIndex, success: false };
      }
    };
    
    // Function to create download tasks with improved error handling
    const createDownloadTasks = async () => {
      // Create a queue of chunk indices to download
      let chunkQueue = Array.from({ length: totalChunks }, (_, i) => i);
      
      // Process the queue with parallel workers
      while (chunkQueue.length > 0 || failedChunks.length > 0) {
        // First retry any failed chunks
        if (failedChunks.length > 0) {
          console.log(`Retrying ${failedChunks.length} failed chunks...`);
          chunkQueue = [...failedChunks];
          failedChunks = [];
        }
        
        if (chunkQueue.length === 0) break;
        
        const currentBatch = [];
        
        // Take up to PARALLEL_DOWNLOADS chunks from the queue
        for (let i = 0; i < Math.min(PARALLEL_DOWNLOADS, chunkQueue.length); i++) {
          const chunkIndex = chunkQueue.shift();
          currentBatch.push(downloadChunk(chunkIndex));
        }
        
        // Wait for the current batch to complete before starting the next batch
        if (currentBatch.length > 0) {
          const results = await Promise.all(currentBatch);
          
          // Check for any failed chunks in this batch
          const newFailedChunks = results
            .filter(result => !result.success)
            .map(result => result.chunkIndex);
          
          if (newFailedChunks.length > 0) {
            failedChunks.push(...newFailedChunks);
          }
        }
      }
    };
    
    // Start the download process
    await createDownloadTasks();
    
    // Check if we still have failed chunks after all retries
    if (failedChunks.length > 0) {
      throw new Error(`Failed to download ${failedChunks.length} chunks after multiple retries`);
    }
    
    // Verify all chunks were downloaded
    const missingChunks = chunks.findIndex(chunk => chunk === null);
    if (missingChunks !== -1) {
      throw new Error(`Missing chunks detected at index ${missingChunks}`);
    }
    
    // Final progress update
    progressCallback(`Downloading ${fileName}... 100%`);
    console.log(`Parallel chunked download complete for ${fileName}. Total size: ${downloadedSize} bytes`);
    
    // Combine all chunks into a single blob with proper memory management
    try {
      // Create blob in smaller batches to avoid memory issues with very large files
      if (totalChunks > 100) {
        console.log(`Large file detected (${totalChunks} chunks), creating blob in batches`);
        const BATCH_SIZE = 50; // Process 50 chunks at a time
        const blobParts = [];
        
        for (let i = 0; i < totalChunks; i += BATCH_SIZE) {
          const end = Math.min(i + BATCH_SIZE, totalChunks);
          const batchChunks = chunks.slice(i, end);
          blobParts.push(new Blob(batchChunks));
          
          // Clear references to processed chunks to help garbage collection
          for (let j = i; j < end; j++) {
            chunks[j] = null;
          }
        }
        
        return new Blob(blobParts);
      } else {
        // For smaller files, create blob directly
        return new Blob(chunks);
      }
    } catch (blobError) {
      console.error('Error creating blob from chunks:', blobError);
      throw new Error(`Failed to create file from downloaded chunks: ${blobError.message}`);
    }
  } catch (error) {
    console.error('Error in parallel chunked download:', error);
    progressCallback(`Download failed: ${error.message}`);
    throw error;
  }
}

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