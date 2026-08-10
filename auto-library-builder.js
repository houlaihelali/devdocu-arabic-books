const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const { exec } = require('child_process');

const GITHUB_USERNAME = 'houlaihelali';
const REPO_NAME = 'devdocu-arabic-books';
const BRANCH = 'main';
const MAX_PAGES_PER_BOOK = 1500; 
const CATEGORY_URL = 'https://shamela.ws/category/9'; 

async function autoBuildLibrary() {
    let libraryCatalog = [];
    
    if (fs.existsSync('full-txt-catalog.json')) {
        const rawData = fs.readFileSync('full-txt-catalog.json');
        libraryCatalog = JSON.parse(rawData);
    }

    console.log('Starting Fully Automated Library Builder...');

    try {
        const { data } = await axios.get(CATEGORY_URL);
        const $ = cheerio.load(data);
        const bookLinks = [];
        
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.match(/\/book\/\d+$/)) {
                const fullUrl = href.startsWith('http') ? href : `https://shamela.ws${href}`;
                if(!bookLinks.includes(fullUrl)) bookLinks.push(fullUrl);
            }
        });

        console.log(`Found ${bookLinks.length} books in category. Commencing mass extraction...`);

        for (let i = 0; i < bookLinks.length; i++) {
            const bookUrl = bookLinks[i];
            const bookId = bookUrl.split('/').filter(Boolean).pop();
            
            const isAlreadyDownloaded = libraryCatalog.some(book => book.id === `shamela_full_${bookId}`);
            if (isAlreadyDownloaded) {
                console.log(`Book ${bookId} already exists. Skipping...`);
                continue;
            }
            
            try {
                const bookPage = await axios.get(bookUrl);
                let $$ = cheerio.load(bookPage.data);
                
                const title = $$('h1').first().text().trim() || `Shamela_Book_${bookId}`;
                console.log(`\n[${i + 1}/${bookLinks.length}] Extracting: ${title}`);
                
                let fullBookText = `${title}\n\n`;
                let currentPage = 1;
                let hasMorePages = true;

                while (hasMorePages && currentPage <= MAX_PAGES_PER_BOOK) {
                    const pageUrl = `https://shamela.ws/book/${bookId}/${currentPage}`;
                    
                    try {
                        const pageData = await axios.get(pageUrl, { validateStatus: false });
                        
                        if (pageData.status !== 200) {
                            hasMorePages = false;
                            break;
                        }

                        const $$$ = cheerio.load(pageData.data);
                        let pageText = '';

                        $$$('.nass').each((index, element) => {
                            const paragraph = $$$(element).text().trim();
                            if (paragraph.length > 5) pageText += paragraph + '\n\n';
                        });

                        if (!pageText) {
                            $$$('p').each((index, element) => {
                                const paragraph = $$$(element).text().trim();
                                if (paragraph.length > 30 && !paragraph.includes('المشروع لجمع')) {
                                    pageText += paragraph + '\n\n';
                                }
                            });
                        }

                        if (pageText) {
                            fullBookText += `\n\n--- Page ${currentPage} ---\n\n` + pageText;
                            process.stdout.write(`* Saving page ${currentPage}... \r`);
                            currentPage++;
                            await new Promise(resolve => setTimeout(resolve, 800));
                        } else {
                            hasMorePages = false;
                        }
                    } catch (pageErr) {
                        hasMorePages = false;
                    }
                }

                if (currentPage > 1) {
                    const fileName = `shamela_full_${bookId}.txt`;
                    fs.writeFileSync(fileName, fullBookText, 'utf8');

                    const githubRawUrl = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${REPO_NAME}/${BRANCH}/${fileName}`;
                    
                    libraryCatalog.push({
                        id: `shamela_full_${bookId}`,
                        title: title,
                        format: 'txt',
                        pages_crawled: currentPage - 1,
                        bookUrl: githubRawUrl
                    });
                    
                    console.log(`\nSuccess! ${title} saved. Updating catalog...`);
                    fs.writeFileSync('full-txt-catalog.json', JSON.stringify(libraryCatalog, null, 2), 'utf8');
                }
                
            } catch (err) {
                console.log(`Error processing ${bookId}. Moving to next.`);
            }
        }

        console.log('\n\nAll books extracted! Initiating Auto-Push to GitHub...');
        pushToGitHub();
        
    } catch (error) {
        console.error('Connection Error:', error.message);
    }
}

function pushToGitHub() {
    const commitMessage = `Auto-added new books - ${new Date().toISOString()}`;
    const gitCommand = `git add . && git commit -m "${commitMessage}" && git push origin ${BRANCH}`;

    exec(gitCommand, (error, stdout, stderr) => {
        if (error) {
            console.error(`\nGitHub Push Failed: ${error.message}`);
            return;
        }
        if (stderr) {
            console.log(`\nGit Info: ${stderr}`);
        }
        console.log(`\nGitHub Push Successful:\n${stdout}`);
        console.log('✅ Your Smart Library is now live with the new books!');
    });
}

autoBuildLibrary();