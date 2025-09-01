const connectButton = document.getElementById('connectButton');
const disconnectButton = document.getElementById('disconnectButton');
const clearButton = document.getElementById('clearButton');
const sendButton = document.getElementById('sendButton');
const inputData = document.getElementById('inputData');
const outputTextarea = document.getElementById('output');

const odoSpan = document.getElementById('odo');
const totalTimeSpan = document.getElementById('total-time');
const tripDistSpan = document.getElementById('trip-dist');
const tripTimeSpan = document.getElementById('trip-time');
const remainDistSpan = document.getElementById('remain-dist');
const batteryPercentSpan = document.getElementById('battery-percent');
const errorFlagsSpan = document.getElementById('error-flags');
const errorDetailsDiv = document.getElementById('error-details');

let port;
let keepReading = false;
let reader;
let receiveBuffer = [];

// 處理連線狀態，更新 UI
function setConnected(isConnected) {
    if (isConnected) {
        connectButton.disabled = true;
        disconnectButton.disabled = false;
        sendButton.disabled = false;
        inputData.disabled = false;
    } else {
        connectButton.disabled = false;
        disconnectButton.disabled = true;
        sendButton.disabled = true;
        inputData.disabled = true;
    }
}

// 讀取資料函數
async function readData() {
    reader = port.readable.getReader();
    keepReading = true;

    try {
        while (port.readable && keepReading) {
            const { value, done } = await reader.read();
            if (done) {
                outputTextarea.value += '讀取器已釋放。\n';
                break;
            }
            receiveBuffer.push(...Array.from(value));
            
            parsePacket();
            
            const hexString = Array.from(value)
                                .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
                                .join(' ');

            outputTextarea.value += `收到原始資料: ${hexString}\n`;
        }
    } catch (error) {
        outputTextarea.value += `讀取錯誤: ${error.message}\n`;
    } finally {
        reader.releaseLock();
    }
}

// 最終修正後的 parsePacket() 函式
function parsePacket() {
    const startByte = 0xFB;
    const endByte = 0xFE;
    const minPacketLength = 5;

    let startIndex = receiveBuffer.indexOf(startByte);

    while (startIndex !== -1 && receiveBuffer.length >= startIndex + minPacketLength) {
        const len = receiveBuffer[startIndex + 2];
        const packetEndIndex = startIndex + 2 + len + 1;

        if (receiveBuffer.length < packetEndIndex) {
            break;
        }
        
        if (receiveBuffer[packetEndIndex - 1] !== endByte) {
            outputTextarea.value += `❌ 終止字元不符。預期: 0x${endByte.toString(16).toUpperCase()}, 實際: 0x${receiveBuffer[packetEndIndex - 1].toString(16).toUpperCase()}\n`;
            receiveBuffer.splice(0, startIndex + 1);
            startIndex = receiveBuffer.indexOf(startByte);
            continue;
        }
        
        const cmd = receiveBuffer[startIndex + 2];
        const cs = receiveBuffer[packetEndIndex - 2];
        
        const dataBytes = receiveBuffer.slice(startIndex + 3, startIndex + 3 + (len - 2));

        let calculatedCS = 0;
        calculatedCS += len;
        calculatedCS += cmd;
        for (const byte of dataBytes) {
            calculatedCS += byte;
        }
        calculatedCS = calculatedCS & 0xFF;

        if (calculatedCS === cs) {
            if (cmd === 0x11) {
                parseData11(dataBytes);
            }
            outputTextarea.value += `✅ 成功解析一個有效封包 (CMD: 0x${cmd.toString(16).toUpperCase()})\n`;
        } else {
            outputTextarea.value += `❌ Checksum 驗證失敗。預期: 0x${calculatedCS.toString(16).toUpperCase()}, 實際: 0x${cs.toString(16).toUpperCase()}\n`;
        }
        
        receiveBuffer.splice(0, packetEndIndex);
        startIndex = receiveBuffer.indexOf(startByte);
    }
}

// 修正後的 parseData11() 函式
function parseData11(dataBytes) {
    if (dataBytes.length < 15) {
        errorFlagsSpan.textContent = '--';
        errorDetailsDiv.textContent = '資料不完整';
        return;
    }
    
    const odo = ((dataBytes[2] << 16) | (dataBytes[1] << 8) | dataBytes[0]) / 10;
    odoSpan.textContent = odo.toFixed(1);

    const totalTime = (dataBytes[5] << 16) | (dataBytes[4] << 8) | dataBytes[3];
    totalTimeSpan.textContent = totalTime;

    const tripDist = ((dataBytes[7] << 8) | dataBytes[6]) / 10;
    tripDistSpan.textContent = tripDist.toFixed(1);

    const tripTime = (dataBytes[10] << 16) | (dataBytes[9] << 8) | dataBytes[8];
    tripTimeSpan.textContent = tripTime;

    const remainDist = dataBytes[11];
    remainDistSpan.textContent = remainDist;

    const batteryPercent = dataBytes[13];
    batteryPercentSpan.textContent = batteryPercent;

    const errorFlags = dataBytes[14];
    errorFlagsSpan.textContent = `0x${errorFlags.toString(16).toUpperCase()}`;

    let errorMessages = [];
    if (errorFlags & 0x01) errorMessages.push("控制器錯誤");
    if (errorFlags & 0x02) errorMessages.push("儀表錯誤");
    if (errorFlags & 0x04) errorMessages.push("電池錯誤");
    if (errorFlags & 0x08) errorMessages.push("限流旗標");
    
    errorDetailsDiv.textContent = errorMessages.length > 0 ? errorMessages.join(", ") : "無錯誤";
}


//javascript
// 連接按鈕事件
connectButton.addEventListener('click', async () => {
    if (!('serial' in navigator)) {
        alert('您的瀏覽器不支援 Web Serial API。請使用 Chrome 或 Edge。');
        return;
    }

    // 先嘗試自動連線
    const ports = await navigator.serial.getPorts();
    // 你需要替換成你的 STM32 裝置的實際 VID 和 PID
    const targetPort = ports.find(p => p.getInfo().usbVendorId === 0x0483 && p.getInfo().usbProductId === 0x5740);

    if (targetPort) {
        port = targetPort;
        try {
            await port.open({ baudRate: 9600 });
            outputTextarea.value += '已自動連線到 STM32 Virtual ComPort！\n';
            setConnected(true);
            readData();
        } catch (error) {
            outputTextarea.value += `自動連線失敗: ${error.message}\n`;
        }
    } else {
        // 如果沒有已授權的埠，則彈出選擇視窗
        try {
            port = await navigator.serial.requestPort();
            await port.open({ baudRate: 9600 });
            outputTextarea.value += '已成功手動連線！\n';
            setConnected(true);
            readData();
        } catch (error) {
            outputTextarea.value += `連線失敗: ${error.message}\n`;
        }
    }
});

// 斷開按鈕事件
disconnectButton.addEventListener('click', async () => {
    if (port) {
        if (reader) {
            await reader.cancel();
        }
        keepReading = false;

        await port.close();
        outputTextarea.value += '已斷開連線！\n';
        setConnected(false);
    }
});

// 清除按鈕事件
clearButton.addEventListener('click', () => {
    outputTextarea.value = '';
});

// 發送按鈕事件
sendButton.addEventListener('click', async () => {
    if (port && port.writable) {
        const dataToSend = inputData.value;
        if (!dataToSend) {
            outputTextarea.value += '請先輸入要發送的資料。\n';
            return;
        }

        const writer = port.writable.getWriter();
        const encoder = new TextEncoder();
        const data = encoder.encode(dataToSend + '\n');

        try {
            await writer.write(data);
            outputTextarea.value += `已發送資料: ${dataToSend}\n`;
            inputData.value = '';
        } catch (error) {
            outputTextarea.value += `發送失敗: ${error.message}\n`;
        } finally {
            writer.releaseLock();
        }
    } else {
        outputTextarea.value += '請先連接序列埠。\n';
    }
});