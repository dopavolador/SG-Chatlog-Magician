$(document).ready(function() {

    // Debug mode - set to false for production
    const DEBUG_MODE = false;

    let applyBackground = false;
    let applyCensorship = false;
    let disableCharacterNameColoring = false;

    const $textarea = $("#chatlogInput");
    const $output = $("#output");
    const $toggleBackgroundBtn = $("#toggleBackground");
    const $toggleCensorshipBtn = $("#toggleCensorship");
    const $toggleCharacterNameColoringBtn = $("#toggleCharacterNameColoring");
    const $censorCharButton = $("#censorCharButton");
    const $lineLengthInput = $("#lineLengthInput");
    const $characterNameInput = $("#characterNameInput");
    const $toggleColorPaletteBtn = $("#toggleColorPalette");
    let $colorPalette = $("#colorPalette");

    $toggleBackgroundBtn.click(toggleBackground);
    $toggleCensorshipBtn.click(toggleCensorship);
    $toggleCharacterNameColoringBtn.click(toggleCharacterNameColoring);
    $censorCharButton.click(copyCensorChar);
    $lineLengthInput.on("input", processOutput);
    $characterNameInput.on("input", applyFilter);
    $textarea.off("input").on("input", throttle(processOutput, 200));

    function toggleBackground() {
        applyBackground = !applyBackground;
        $output.toggleClass("background-active", applyBackground);

        $toggleBackgroundBtn.toggleClass("active", applyBackground);

        processOutput();
    }

    function toggleCensorship() {
        applyCensorship = !applyCensorship;
        $toggleCensorshipBtn.toggleClass("active", applyCensorship);
        processOutput();
    }

    function toggleCharacterNameColoring() {
        disableCharacterNameColoring = !disableCharacterNameColoring;
        $toggleCharacterNameColoringBtn.toggleClass("active", !disableCharacterNameColoring);
        processOutput();
    }

    function applyFilter() {
        processOutput();
    }

    // Make applyFilter globally accessible
    window.applyFilter = applyFilter;

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    function throttle(func, limit) {
        let lastFunc, lastRan;
        return function() {
            const context = this;
            const args = arguments;
            if (!lastRan) {
                func.apply(context, args);
                lastRan = Date.now();
            } else {
                clearTimeout(lastFunc);
                lastFunc = setTimeout(function() {
                    if (Date.now() - lastRan >= limit) {
                        func.apply(context, args);
                        lastRan = Date.now();
                    }
                }, limit - (Date.now() - lastRan));
            }
        };
    }

    function escapeRegex(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Regex para detectar verbos de habla en español
    const SPEECH_VERB_PATTERN = /\b(dice|grita|susurra)\b/;
    // Regex para extraer nombre del hablante y posible destinatario
    // Formato: "Nombre dice: ..." o "Nombre dice a Destinatario: ..."
    const SPEECH_LINE_PATTERN = /^(.+?)\s+(?:dice|grita|susurra)(?:\s+a\s+(.+?))?\s*:/;

    function formatSaysLine(line, currentCharacterName) {
        if (!currentCharacterName || disableCharacterNameColoring) {
            return wrapSpan("white", line);
        }

        const match = line.match(SPEECH_LINE_PATTERN);
        const speakerName = match ? match[1].trim().toLowerCase() : '';
        const targetName = match && match[2] ? match[2].trim().toLowerCase() : '';

        let mainColor;
        if (targetName) {
            if (targetName === currentCharacterName.toLowerCase()) {
                mainColor = "white";
            } else {
                mainColor = (speakerName === currentCharacterName.toLowerCase()) ? "white" : "lightgrey";
            }
        } else {
            mainColor = (speakerName === currentCharacterName.toLowerCase()) ? "white" : "lightgrey";
        }

        return wrapSpan(mainColor, line);
    }

    function replaceDashes(text) {
        return text.replace(/(\.{2,3}-|-\.{2,3})/g, '—');
    }

    function replaceCurlyApostrophes(text) {
        // More comprehensive approach: replace any character in the curly apostrophe Unicode range
        let result = text;
        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i);
            if (charCode >= 8216 && charCode <= 8219 && charCode !== 39) {
                result = result.replace(text[i], "'");
            }
        }
        
        // Also try the regex approach
        result = result.replace(/['''']/g, "'");
        
        return result;
    }

    function processOutput() {
        const chatText = $textarea.val();
        const chatLines = chatText.split("\n")
                                  .map(removeTimestamps)
                                  .map(replaceDashes)
                                  .map(replaceCurlyApostrophes);

        const fragment = document.createDocumentFragment();

        chatLines.forEach((line) => {

            const div = document.createElement("div");
            div.className = "generated";

            {
                let formattedLine = formatLineWithFilter(line);

                // Apply censorship after formatting to catch plain lines
                formattedLine = applyUserCensorship(formattedLine);
                div.innerHTML = addLineBreaksAndHandleSpans(formattedLine);
                
                // If the formatted line contains HTML (like [!] lines), mark it to skip makeTextColorable
                if (formattedLine.includes('<span') || formattedLine.includes('<div')) {
                    div.classList.add('no-colorable');
                }
            }
            
            fragment.appendChild(div);

            const clearDiv = document.createElement("div");
            clearDiv.className = "clear";
            fragment.appendChild(clearDiv);
        });

        $output.html('');
        $output.append(fragment);
        cleanUp();

        makeTextColorable();
    }

    // Make processOutput globally accessible
    window.processOutput = processOutput;

    function makeTextColorable() {
        // Process each .generated div individually
        $output.find('.generated').each(function() {
            const generatedDiv = $(this);
            
            // Skip if the div has the no-colorable class
            if (generatedDiv.hasClass('no-colorable')) {
                return;
            }
            
            // Check if the div contains HTML elements (like spans)
            const hasElements = generatedDiv.find('span, div, br').length > 0;
            const hasSpanInHTML = generatedDiv.html().includes('<span');
            const hasDivInHTML = generatedDiv.html().includes('<div');
            const hasBrInHTML = generatedDiv.html().includes('<br');
            
            // If the div contains HTML elements, process them for word-by-word coloring
            if (hasElements || hasSpanInHTML || hasDivInHTML || hasBrInHTML) {
                // Find all text nodes within existing spans and make them colorable word by word
                generatedDiv.find('span').each(function() {
                    const span = $(this);
                    const text = span.text();
                    
                                    // CORREÇÃO: Pula spans que já foram processados para evitar duplicação.
                if ((span.hasClass('colorable') && span.text().length === 1) || span.children().length > 0) {
                    return; // Skip to the next span
                }
                    
                    // Get the existing classes from the span
                    const existingClasses = span.attr('class') || '';
                    const classArray = existingClasses.split(/\s+/).filter(cls => cls !== 'colorable');
                    
                    // Split the text into words and whitespace and wrap each word in a colorable span
                    const tokens = text.split(/(\s+)/g);
                    const html = tokens.map(token => {
                        if (token === '') return '';
                        if (/^\s+$/.test(token)) return token;
                        const normalized = token.replace(/[\u2018\u2019\u2032\u2035]/g, "'");
                        return `<span class="${classArray.join(' ')} colorable">${normalized}</span>`;
                    }).join('');
                    
                    // Replace the span's content with the word-by-word HTML
                    span.html(html);
                });
                return;
            }
            
            // Get all child nodes (both elements and text nodes)
            const childNodes = generatedDiv[0].childNodes;
            const nodesToProcess = [];
            
            // Collect text nodes that should be processed
            for (let i = 0; i < childNodes.length; i++) {
                const node = childNodes[i];
                
                // Only process text nodes
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent.trim();
                    
                    // Skip empty text nodes
                    if (text.length === 0) continue;
                    
                    // Skip text nodes that contain HTML-like content
                    if (/<[^>]*>/.test(text) || /&[a-zA-Z0-9#]+;/.test(text)) continue;
                    
                    nodesToProcess.push(node);
                }
            }
            
            // Process the collected text nodes (word-by-word)
            nodesToProcess.forEach(textNode => {
                const text = textNode.textContent;
                const parent = textNode.parentNode;
                
                const temp = document.createElement('div');
                
                // Split into words and whitespace for word-by-word selection
                const tokens = text.split(/(\s+)/g);
                const html = tokens.map(token => {
                    if (token === '') return '';
                    if (/^\s+$/.test(token)) return token;
                    const normalized = token.replace(/[\u2018\u2019\u2032\u2035]/g, "'");
                    return `<span class="colorable">${normalized}</span>`;
                }).join('');
                
                temp.innerHTML = html;
                
                const fragment = document.createDocumentFragment();
                while (temp.firstChild) {
                    fragment.appendChild(temp.firstChild);
                }
                
                parent.replaceChild(fragment, textNode);
            });
        });
        
        // NEW: Make ALL remaining text colorable, word-by-word, even if not recognized by parser
        $output.find('.generated').each(function() {
            const generatedDiv = $(this);
            
            // Skip if already processed or has no-colorable class
            if (generatedDiv.hasClass('no-colorable') || generatedDiv.find('.colorable').length > 0) {
                return;
            }
            
            // Get all text content that hasn't been processed yet
            const textContent = generatedDiv.text().trim();
            if (textContent.length === 0) return;
            
            // Split into words and whitespace for word-by-word selection
            const tokens = textContent.split(/(\s+)/g);
            const html = tokens.map(token => {
                if (token === '') return '';
                if (/^\s+$/.test(token)) return token;
                const normalized = token.replace(/[\u2018\u2019\u2032\u2035]/g, "'");
                return `<span class="colorable unrecognized">${normalized}</span>`;
            }).join('');
            
            // Apply line breaks to the HTML with individual character spans
            const htmlWithLineBreaks = addLineBreaksAndHandleSpans(html);
            
            // Replace the entire content with the character-by-character HTML that has line breaks
            generatedDiv.html(htmlWithLineBreaks);
        });
        
        if (DEBUG_MODE) console.log("Made text colorable - total colorable elements: " + $output.find('.colorable').length);
    }

    // Make makeTextColorable globally accessible for the color palette
    window.makeTextColorable = makeTextColorable;

    function applyUserCensorship(line) {
        // Use a more robust approach that handles browser compatibility issues
        // Replace ÷ with a more reliable delimiter and handle edge cases
        try {
            return line.replace(/÷(.*?)÷/g, (match, p1) => {
                // Ensure we're not duplicating content
                if (p1 && p1.trim()) {
                    return `<span class="hidden censored-content" data-original="${p1.replace(/"/g, '&quot;')}">${p1}</span>`;
                }
                return match; // Return original if no content to censor
            });
        } catch (error) {
            // Fallback for browsers with regex issues
            console.warn('Censorship regex failed, using fallback method:', error);
            return line.replace(/÷/g, '÷'); // Just return the line as-is if regex fails
        }
    }

    function removeTimestamps(line) {
        return line.replace(/\[\d{2}:\d{2}:\d{2}\] /g, "").trim();
    }

    function formatLineWithFilter(line) {
        // Strip censorship markers for formatting logic
        const cleanLine = line.replace(/÷(.*?)÷/g, '$1');
        const lowerLine = cleanLine.toLowerCase();

        const formattedLine = applySpecialFormatting(line, lowerLine);
        if (formattedLine) {
            return formattedLine;
        }

        const currentCharacterName = $("#characterNameInput").val().toLowerCase().trim();
        // Detectar líneas de diálogo en español (dice, grita, susurra)
        if (currentCharacterName && currentCharacterName !== "" && SPEECH_VERB_PATTERN.test(lowerLine)) {
            return formatSaysLine(cleanLine, currentCharacterName);
        }

        return formatLine(line);
    }

    function applySpecialFormatting(line, lowerLine) {
        const trimmed = line.trim();

        // 1) /intentar — éxito
        if (lowerLine.includes("y lo logra.")) {
            return wrapSpan("success", line);
        }

        // 2) /intentar — fallo
        if (lowerLine.includes("pero falla.")) {
            return wrapSpan("fail", line);
        }

        // 3) /do — comienza con "*" y termina con "))"
        if (trimmed.startsWith("*") && /\)\)\s*$/.test(trimmed)) {
            // Usa tu clase de color para /do
            return wrapSpan("do", line);
        }

        // 4) /me — comienza con "*"
        if (trimmed.startsWith("*")) {
            return wrapSpan("me", line);
        }

        // Nada especial -> que lo maneje el formateo genérico aguas abajo
        return null;
    }

    function formatLine(line) {
        return replaceColorCodes(line);
    }

    function formatJailTime(line) {
        const pattern = /(You have) (.*?) (left in jail\.)/;
        const match = line.match(pattern);
        if (match) {
            return `<span class="white">${escapeHTML(match[1])}</span> <span class="green">${escapeHTML(match[2])}</span> <span class="white">${escapeHTML(match[3])}</span>`;
        }
        return line;
    }

    function escapeHTML(text) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    function wrapSpan(className, content) {
        // Normalize apostrophes and escape HTML to prevent tag injection
        content = escapeHTML(content.replace(/['''']/g, "'"));
        
        const tokens = content.split(/(\s+)/g);
        let html = '';
        let censoring = false;
        let censorBuffer = '';
        let visibleBuffer = '';

        const flushCensor = () => {
            if (censorBuffer.length > 0) {
                html += `<span class="hidden censored-content" data-original="${censorBuffer}">${censorBuffer}</span>`;
                censorBuffer = '';
            }
        };

        const flushVisible = () => {
            if (visibleBuffer.length > 0) {
                html += `<span class="${className} colorable">${visibleBuffer}</span>`;
                visibleBuffer = '';
            }
        };

        tokens.forEach(token => {
            if (token === '') return;
            if (/^\s+$/.test(token)) {
                // On whitespace, flush any visible buffer and pass whitespace through
                if (censoring) {
                    censorBuffer += token;
                } else {
                    flushVisible();
                    html += token;
                }
                return;
            }

            // Process non-whitespace token character-by-character to handle censorship toggles
            for (const char of token) {
                if (char === '÷') {
                    if (censoring) {
                        // closing delimiter
                        flushCensor();
                        censoring = false;
                    } else {
                        // opening delimiter
                        flushVisible();
                        censoring = true;
                    }
                } else if (censoring) {
                    censorBuffer += char;
                } else {
                    visibleBuffer += char;
                }
            }
            // At end of token (word), flush visible as a single word span
            if (!censoring) {
                flushVisible();
            }
        });

        if (censoring) {
            // unmatched delimiter, append as plain text
            html += censorBuffer;
        }

        return html;
    }

    function formatWeatherLine(line) {
        const weatherPattern = /^Temperature:\s*([\d.]+°C)\s*\(([\d.]+°?F)\),\s*it\s*is\s*currently\s*([^.]+)\.\s*Wind:\s*([\d.]+)\s*km\/h\s*\(([\d.]+)\s*mph\),\s*humidity:\s*([\d.]+%),\s*rain\s*precipitation:\s*([\d.]+)\s*mm\.\s*Current\s*time:\s*([\d\/A-Z\s-]+:\d{2}:\d{2}:\d{2})$/;
        
        const match = line.match(weatherPattern);
        if (match) {
            const [_, tempC, tempF, condition, windKmh, windMph, humidity, rain, time] = match;
            
            return wrapSpan("white", "Temperature: ") + 
                   wrapSpan("green", tempC) + " " + 
                   wrapSpan("white", "(") + 
                   wrapSpan("green", tempF) + 
                   wrapSpan("white", ")") + 
                   wrapSpan("white", ", it is currently ") + 
                   wrapSpan("green", condition) + 
                   wrapSpan("white", ". Wind: ") + 
                   wrapSpan("green", windKmh + " km/h") + 
                   " " + 
                   wrapSpan("white", "(") + 
                   wrapSpan("green", windMph + " mph") + 
                   wrapSpan("white", ")") + 
                   wrapSpan("white", ", humidity: ") + 
                   wrapSpan("green", humidity) + 
                   wrapSpan("white", ", rain precipitation: ") + 
                   wrapSpan("green", rain + " mm") + 
                   wrapSpan("white", ". Current time: ") + 
                   wrapSpan("white", time);
        }
        
        if (line.startsWith("Temperature:")) {
            const tempMatch = line.match(/^Temperature:\s*([\d.]+°C)\s*\(([\d.]+°?F)\),\s*it\s*is\s*currently\s*([^.]+)\.?$/);
            if (tempMatch) {
                const [_, tempC, tempF, condition] = tempMatch;
                return wrapSpan("white", "Temperature: ") + 
                       wrapSpan("green", tempC) + " " + 
                       wrapSpan("white", "(") + 
                       wrapSpan("green", tempF) + 
                       wrapSpan("white", ")") + 
                       wrapSpan("white", ", it is currently ") + 
                       wrapSpan("green", condition) + ".";
            }
            return wrapSpan("white", "Temperature: ") + 
                   wrapSpan("green", line.replace("Temperature:", "").trim());
        }
        
        if (line.startsWith("Wind:")) {
            const windMatch = line.match(/^Wind:\s*([\d.]+)\s*km\/h\s*\(([\d.]+)\s*mph\),\s*humidity:\s*([\d.]+%),\s*rain\s*precipitation:\s*([\d.]+)\s*mm\.?$/);
            if (windMatch) {
                const [_, windKmh, windMph, humidity, rain] = windMatch;
                return wrapSpan("white", "Wind: ") + 
                       wrapSpan("green", windKmh + " km/h") + 
                       " " + 
                       wrapSpan("white", "(") + 
                       wrapSpan("green", windMph + " mph") + 
                       wrapSpan("white", ")") + 
                       wrapSpan("white", ", humidity: ") + 
                       wrapSpan("green", humidity) + 
                       wrapSpan("white", ", rain precipitation: ") + 
                       wrapSpan("green", rain + " mm") + ".";
            }
            return wrapSpan("white", "Wind: ") + 
                   wrapSpan("green", line.replace("Wind:", "").trim());
        }
        
        if (line.startsWith("Current time:")) {
            return wrapSpan("white", "Current time: ") + 
                   wrapSpan("white", line.replace("Current time:", "").trim());
        }
        
        return null;
    }

    function isRadioLine(line) {
        return /\[S: \d+ \| CH: .+\]/.test(line);
    }

    function handleWhispers(line) {
        if (line.startsWith("(Car)")) {
            return wrapSpan("yellow", line);
        }

        const groupWhisperPattern = /^[A-Z][a-z]+\s[A-Z][a-z]+\swhispers to \d+\speople/i;
        const match = line.match(groupWhisperPattern);
        if (match) {
            const splitIndex = match.index + match[0].length;
            return `<span class="orange">${escapeHTML(line.slice(0, splitIndex))}</span><span class="whisper">${escapeHTML(line.slice(splitIndex))}</span>`;
        }

        return wrapSpan("whisper", line);
    }    

    function handleCellphone(line) {
        const hasExclamation = line.startsWith("!");
        const cleanLine = hasExclamation ? line.slice(1) : line;
        return wrapSpan(hasExclamation ? "yellow" : "white", cleanLine);
    }

    function handleGoods(line) {
        return wrapSpan(
            "yellow",
            line.replace(/(\$\d+)/, '<span class="green">$1</span>')
        );
    }

    function handleTransaction(line) {

        if (line.includes("/")) {
            line = line.replace(/\s*\(\d{2}\/[A-Z]{3}\/\d{4}\s+-\s+\d{2}:\d{2}:\d{2}\)\.?/, "");
            return wrapSpan("green", line + ".");
        }

        return wrapSpan("green", line);
    }

    function formatInfo(line) {
        const moneyMatch = line.match(/\$(\d+)/);
        const itemMatch = line.match(/took\s(.+?)\s\((\d+)\)\sfrom\s(the\s.+)\.$/i);

        if (moneyMatch) {
            const objectMatch = line.match(/from the (.+)\.$/i);
            return objectMatch ?
                `<span class="orange">Info:</span> <span class="white">You took</span> <span class="green">$${escapeHTML(moneyMatch[1])}</span> <span class="white">from the ${escapeHTML(objectMatch[1])}</span>.` :
                line;
        }

        if (itemMatch) {
            const itemName = escapeHTML(itemMatch[1]);
            const itemQuantity = escapeHTML(itemMatch[2]);
            const fromObject = escapeHTML(itemMatch[3]);

            return `<span class="orange">Info:</span> <span class="white">You took</span> <span class="white">${itemName}</span> <span class="white">(${itemQuantity})</span> <span class="white">from ${fromObject}</span>.`;
        }

        return line;
    }

    function formatSmsMessage(line) {
        // Match the pattern: (phone) Message from sender: content
        const match = line.match(/^\(([^)]+)\)\s+Message from ([^:]+):\s*(.+)$/);
        
        if (match) {
            const phone = match[1];
            const sender = match[2];
            const message = match[3];
            
            // Remove brackets only from the phone identifier, preserve them in the message
            const cleanPhone = phone.replace(/[\[\]]/g, '');
            
            return wrapSpan('yellow', `(${cleanPhone}) Message from ${sender}: ${message}`);
        }
        
        // Fallback: if pattern doesn't match, just remove brackets from the whole line
        line = line.replace(/[\[\]]/g, '');
        return wrapSpan('yellow', line);
    }

    function formatPhoneSet(line) {

        line = line.replace(/\[(?!INFO\])|\](?!)/g, '');

        line = line.replace('[INFO]', '<span class="green">[INFO]</span>');

        const infoTag = '<span class="green">[INFO]</span>';
        const restOfLine = escapeHTML(line.replace(/\[INFO\]/, '').trim());
        return infoTag + ' <span class="white">' + restOfLine + '</span>';
    }

    function formatIncomingCall(line) {

        line = line.replace(/[\[\]]/g, '');

        const match = line.match(/\(([^)]+)\) Incoming call from (.+)\. Use (.+) to answer or (.+) to decline\./);
        if (match) {
            const parenthetical = escapeHTML(match[1]);
            const caller = escapeHTML(match[2]);
            const pickupCommand = escapeHTML(match[3]);
            const hangupCommand = escapeHTML(match[4]);

            return '<span class="yellow">(' + parenthetical + ')</span> <span class="white">Incoming call from </span><span class="yellow">' + caller + '</span><span class="white">. Use ' + pickupCommand + ' to answer or ' + hangupCommand + ' to decline.</span>';
        } else {
            return '<span class="white">' + escapeHTML(line) + '</span>';
        }
    }

    function colorInfoLine(line) {

        line = line.replace(/\[(?!INFO\])|(?<!INFO)\]/g, '');
        line = line.replace('[INFO]', '<span class="blue">[INFO]</span>');

        if (line.includes('You have received a contact')) {
            if (line.includes('/acceptnumber')) {
                return applyPhoneRequestFormatting(line);
            } else if (line.includes('/acceptcontact')) {
                return applyContactShareFormatting(line);
            }
        } else if (line.includes('You have shared your number with')) {
            return applyNumberShareFormatting(line);
        } else if (line.includes('You have shared')) {
            return applyContactSharedFormatting(line);
        }

        return '<span class="white">' + line + '</span>';
    }

    function applyPhoneRequestFormatting(line) {
        const pattern = /\[INFO\] You have received a contact \((.+), ([^\)]+)\) from (.+)\. Use (\/acceptnumber) to accept it\./;

        const match = line.match(pattern);

        if (match) {
            const contactName = escapeHTML(match[1]);
            const numbers = escapeHTML(match[2]);
            const sender = escapeHTML(match[3]);
            const acceptCommand = escapeHTML(match[4]);

            return '<span class="blue">[INFO]</span> <span class="white">You have received a contact (' + contactName + ', ' + numbers + ') from ' + sender + '. Use ' + acceptCommand + ' to accept it.</span>';
        } else {
            return line;
        }
    }

    function applyContactShareFormatting(line) {
        const pattern = /\[INFO\] You have received a contact \((.+), ([^\)]+)\) from (.+)\. Use (\/acceptcontact) to accept it\./;

        const match = line.match(pattern);

        if (match) {
            const contactName = escapeHTML(match[1]);
            const numbers = escapeHTML(match[2]);
            const sender = escapeHTML(match[3]);
            const acceptCommand = escapeHTML(match[4]);

            return '<span class="blue">[INFO]</span> <span class="white">You have received a contact (' + contactName + ', ' + numbers + ') from ' + sender + '. Use ' + acceptCommand + ' to accept it.</span>';
        } else {
            return line;
        }
    }

    function applyNumberShareFormatting(line) {
        const pattern = /\[INFO\] You have shared your number with (.+) under the name (.+)\./;

        const match = line.match(pattern);

        if (match) {
            const receiver = escapeHTML(match[1]);
            const name = escapeHTML(match[2]);

            return '<span class="blue">[INFO]</span> <span class="white">You have shared your number with ' + receiver + ' under the name ' + name + '.</span>';
        } else {
            return line;
        }
    }

    function applyContactSharedFormatting(line) {
        const pattern = /\[INFO\] You have shared (.+) \(([^\)]+)\) with (.+)\./;

        const match = line.match(pattern);

        if (match) {
            const contactName = escapeHTML(match[1]);
            const numbers = escapeHTML(match[2]);
            const receiver = escapeHTML(match[3]);

            return '<span class="blue">[INFO]</span> <span class="white">You have shared ' + contactName + ' (' + numbers + ') with ' + receiver + '.</span>';
        } else {
            return line;
        }
    }

    function formatsuccess(line) {
        const successPattern = /\*\*\s*\[CH: VTS - Vessel Traffic Service\]/;

        if (successPattern.test(line)) {
            return `<span class="success">${escapeHTML(line)}</span>`;
        }

        return line;
    }

    function formatIntercom(line) {
        const match = line.match(/\[(.*?) intercom\]: (.*)/i);
        if (match) {
            const location = escapeHTML(match[1]);
            const message = escapeHTML(match[2]);
            return `<span class="blue">[${location} Intercom]: ${message}</span>`;
        }
        return line;
    }

    function formatPhoneCursor(line) {
        return '<span class="white">Use <span class="yellow">/phonecursor (/pc)</span> to activate the cursor to use the phone.</span>';
    }

    function formatShown(line) {
        const match = line.match(/^(.+) has shown you their (.+)\.$/);
        if (match) {
            const person = escapeHTML(match[1]);
            const item = escapeHTML(match[2]);
            return `<span class="green">${person} has shown you their <span class="white">${item}</span>.</span>`;
        }
        return `<span class="green">${escapeHTML(line)}</span>`;
    }

    function replaceColorCodes(str) {
        // Validate and sanitize hex color codes
        return str
            .replace(
                /\{([A-Fa-f0-9]{6})\}/g,
                (_match, p1) => {
                    // p1 is already validated by regex to be 6 hex chars, but sanitize anyway
                    const safeColor = p1.replace(/[^A-Fa-f0-9]/g, '').substring(0, 6);
                    return '<span style="color: #' + safeColor + ';">';
                }
            )
            .replace(/\{\/([A-Fa-f0-9]{6})\}/g, "</span>");
    }

    function colorMoneyLine(line) {
        const moneyMatch = line.match(/You have received (\$\d+(?:,\d{3})*(?:\.\d{1,3})?)/);
        const fromMatch = line.match(/from (.+) on your bank account\./);
        
        if (moneyMatch && fromMatch) {
            const amount = escapeHTML(moneyMatch[1]);
            const source = escapeHTML(fromMatch[1]);
            return '<span class="white">You have received </span><span class="green">' + amount + '</span><span class="white"> from </span><span class="white">' + source + '</span><span class="white"> on your bank account.</span>';
        }
        return line;
    }

    function colorLocationLine(line) {
        const match = line.match(/(You received a location from) (#\d+)(. Use )(\/removelocation)( to delete the marker\.)/);
        if (match) {
            return '<span class="green">' + escapeHTML(match[1]) + ' </span>' +
                   '<span class="yellow">' + escapeHTML(match[2]) + '</span>' +
                   '<span class="green">' + escapeHTML(match[3]) + '</span>' +
                   '<span class="death">' + escapeHTML(match[4]) + '</span>' +
                   '<span class="green">' + escapeHTML(match[5]) + '</span>';
        }
        return line;
    }

    function formatRobbery(line) {
        const match = line.match(/You're being robbed, use (.+?) to show your inventory/);
        if (match) {
            const command = escapeHTML(match[1]);
            return '<span class="white">You\'re being robbed, use </span><span class="blue">' + command + '</span><span class="white"> to show your inventory</span>';
        }
        return line;
    }

    function formatDrugLab() {
        return '<span class="orange">[DRUG LAB]</span> <span class="white">Drug production has started.</span>';
    }

    function formatCharacterKill(line) {
        return (
            '<span class="blue">[Character kill]</span> <span class="death">' +
            escapeHTML(line.slice(16)) +
            "</span>"
        );
    }

    function formatDrugCut(line) {
        const drugCutPattern = /You've cut (.+?) x(\d+) into x(\d+)\./i;
        const match = line.match(drugCutPattern);

        if (match) {
            const drugName = escapeHTML(match[1]);
            const firstAmount = escapeHTML(match[2]);
            const secondAmount = escapeHTML(match[3]);

            return (
                `<span class="white">You've cut </span>` +
                `<span class="blue">${drugName}</span>` +
                `<span class="blue"> x${firstAmount}</span>` +
                `<span class="white"> into </span><span class="blue">x${secondAmount}</span>` +
                `<span class="blue">.</span>`
            );
        }
        return line;
    }

    function formatPropertyRobbery(line) {
        const robberyPattern = /\[PROPERTY ROBBERY\](.*?)(\$[\d,]+)(.*)/;
        const match = line.match(robberyPattern);

        if (match) {
            const textBeforeAmount = escapeHTML(match[1]);
            const amount = escapeHTML(match[2]);
            const textAfterAmount = escapeHTML(match[3]);

            return `<span class="green">[PROPERTY ROBBERY]</span>${textBeforeAmount}<span class="green">${amount}</span>${textAfterAmount}`;
        }

        return line;
    }

    function formatDrugEffect(line) {
        const pattern = /You've just taken (.+?)! You will feel the effects of the drug soon\./;
        const match = line.match(pattern);

        if (match) {
            const drugName = escapeHTML(match[1]);
            return `<span class="white">You've just taken </span><span class="green">${drugName}</span><span class="white">! You will feel the effects of the drug soon.</span>`;
        }

        return line;
    }

    function formatPrisonPA(line) {
        const pattern = /^\*\* \[PRISON PA\].*\*\*$/;
        if (pattern.test(line)) {
            return `<span class="blue">${escapeHTML(line)}</span>`;
        }
        return line;
    }

    function formatCashTap(line) {
        if (line.includes("[CASHTAP]")) {
            const parts = line.split('[CASHTAP]');
            if (parts.length === 2) {
                const before = escapeHTML(parts[0]);
                const after = escapeHTML(parts[1]);
                return '<span class="white">' + before + '</span><span class="green">[CASHTAP]</span><span class="white">' + after + '</span>';
            }
        }
        return line;
    }

    /**
     * Formats police MDC (Mobile Data Computer) messages with blue highlighting
     * @param {string} line - The line to format
     * @returns {string} The formatted line
     */
    function formatPoliceMDC(line) {
        if (line.includes("[POLICE MDC]")) {
            const parts = line.split('[POLICE MDC]');
            if (parts.length === 2) {
                const before = escapeHTML(parts[0]);
                const after = escapeHTML(parts[1]);
                return '<span class="white">' + before + '</span><span class="blue">[POLICE MDC]</span><span class="white">' + after + '</span>';
            }
        }
        return line;
    }

    function formatCardReader(line) {
        const [prefix, rest] = line.split(":");
        const moneyMatch = rest.match(/\$\d+/);
        const money = moneyMatch ? moneyMatch[0] : "";

        if (line.includes("offers you a card reader")) {

            const nameEnd = rest.indexOf(" offers");
            const name = rest.substring(0, nameEnd);
            const middlePart = rest.substring(nameEnd, rest.lastIndexOf(money));

            return wrapSpan("orange", "Info:") + wrapSpan("yellow", name) + escapeHTML(middlePart) + wrapSpan("green", money) + "!";
        }

        if (line.includes("swiped your card through the reader")) {

            const businessStart = rest.indexOf("reader of ") + "reader of ".length;
            const businessEnd = rest.indexOf(" for an amount");
            const business = rest.substring(businessStart, businessEnd);
            const prefixPart = rest.substring(0, businessStart);

            return wrapSpan("orange", "Info:") + escapeHTML(prefixPart) + wrapSpan("yellow", business) + " for an amount of " + wrapSpan("green", money) + "!";
        }

        if (line.includes("offered your card reader to")) {

            const nameStart = rest.indexOf("reader to ") + "reader to ".length;
            const nameEnd = rest.indexOf(" for an amount");
            const name = rest.substring(nameStart, nameEnd);
            const prefixPart = rest.substring(0, nameStart);

            return wrapSpan("orange", "Info:") + escapeHTML(prefixPart) + wrapSpan("yellow", name) + " for an amount of " + wrapSpan("green", money) + ". Wait for them to accept!";
        }

        if (line.includes("accepted the card payment of")) {

            const nameStart = rest.indexOf("payment of ") + "payment of ".length;
            const nameEnd = rest.indexOf(" for an amount");
            const name = rest.substring(nameStart, nameEnd);
            const prefixPart = rest.substring(0, nameStart);

            return wrapSpan("orange", "Info:") + escapeHTML(prefixPart) + wrapSpan("yellow", name) + " for an amount of " + wrapSpan("green", money) + "!";
        }
    }

    function addLineBreaksAndHandleSpans(text) {
        const maxLineLength = parseInt(document.getElementById("lineLengthInput").value) || 77;
        let result = "";
        let currentLineLength = 0;
        const openSpans = [];
        


        function addLineBreak() {
            if (openSpans.length > 0) {
                // Close all open spans, insert a break, then reopen them
                for (let i = openSpans.length - 1; i >= 0; i--) {
                    result += "</span>";
                }
                result += "<br>";
                for (const span of openSpans) {
                    result += span;
                }
            } else {
                result += "<br>";
            }
            currentLineLength = 0;
        }

        for (let i = 0; i < text.length; i++) {
            if (text[i] === "<" && text.substring(i, i + 5) === "<span") {
                const spanEnd = text.indexOf(">", i);
                const spanTag = text.substring(i, spanEnd + 1);
                openSpans.push(spanTag);
                result += spanTag;
                i = spanEnd;
            } else if (text[i] === "<" && text.substring(i, i + 7) === "</span>") {
                result += "</span>";
                i += 6;
                openSpans.pop();
            } else if (text[i] === "<" && text.substring(i, i + 4) === "<br") {
                // Handle existing <br> tags
                const brEnd = text.indexOf(">", i);
                const brTag = text.substring(i, brEnd + 1);
                result += brTag;
                i = brEnd;
                currentLineLength = 0; // Reset line length after a break
            } else {
                result += text[i];
                currentLineLength++;

                if (currentLineLength >= maxLineLength && text[i] === " ") {
                    addLineBreak();
                }
            }
        }

        return result;
    }

    function cleanUp() {
        $output.find(".generated").each(function() {
            let html = $(this).html();
            html = html.replace(/<br>\s*<br>/g, "<br>");
            html = html.replace(/^<br>|<br>$/g, "");
            html = html.replace(/<span[^>]*>\s*<\/span>/g, "");
            $(this).html(html);
        });
        applyStyles();
    }

    function applyStyles() {
        $(".generated:first").css({
            "margin-top": "0",
            "padding-top": "1px",
        });
        $(".generated:last").css({
            "padding-bottom": "1px",
            "margin-bottom": "0",
        });
        $(".generated").css("background-color", "transparent");

        if (applyBackground) {
            $(".generated").css("background-color", "#000000");
        }
    }

    function copyCensorChar() {

        if (typeof copyToClipboard === 'function') {
            copyToClipboard("÷", this);
        } else {

            const censorChar = "÷";
            try {

                const textarea = document.createElement('textarea');
                textarea.value = censorChar;

                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);

                textarea.focus();
                textarea.select();

                const successful = document.execCommand('copy');
                document.body.removeChild(textarea);

                if (successful) {
                    const $btn = $(this);
                    const originalBg = $btn.css("background-color");
                    const originalText = $btn.text();

                    $btn.css("background-color", "#a8f0c6").text("Copied!");

                    setTimeout(() => {
                        $btn.css("background-color", originalBg).text(originalText);
                    }, 800);
                }
            } catch (err) {
                console.error('Failed to copy: ', err);
            }
        }
    }

    processOutput(); 
});