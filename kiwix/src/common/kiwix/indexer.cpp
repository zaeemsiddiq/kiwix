/*
 * Copyright 2011-2014 Emmanuel Engelhart <kelson@kiwix.org>
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU  General Public License as published by
 * the Free Software Foundation; either version 3 of the License, or
 * any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston,
 * MA 02110-1301, USA.
 */

#include "indexer.h"

namespace kiwix {

  /* Count word */
  unsigned int Indexer::countWords(const string &text) {
    unsigned int numWords = 1;
    unsigned int length = text.size();

    for(unsigned int i=0; i<length;) {
      while(i<length && text[i] != ' ') {
	i++;
      }
      numWords++;
      i++;
    }

    return numWords;
  }
  
  /* Constructor */
  Indexer::Indexer() :
    keywordsBoostFactor(3),
    verboseFlag(false) {

    /* Initialize mutex */
    pthread_mutex_init(&threadIdsMutex, NULL);
    pthread_mutex_init(&toParseQueueMutex, NULL);
    pthread_mutex_init(&toIndexQueueMutex, NULL);
    pthread_mutex_init(&articleExtractorRunningMutex, NULL);
    pthread_mutex_init(&articleParserRunningMutex, NULL);
    pthread_mutex_init(&articleIndexerRunningMutex, NULL);
    pthread_mutex_init(&articleCountMutex, NULL);
    pthread_mutex_init(&zimPathMutex, NULL);
    pthread_mutex_init(&zimIdMutex, NULL);
    pthread_mutex_init(&indexPathMutex, NULL);
    pthread_mutex_init(&progressionMutex, NULL);
    pthread_mutex_init(&verboseMutex, NULL);
  }

  /* Destructor */
  Indexer::~Indexer() {
  }

  /* Read the stopwords */
  void Indexer::readStopWords(const string languageCode) {
    std::string stopWord;
    std::istringstream file(getResourceAsString("stopwords/" + languageCode));

    this->stopWords.clear();

    while (getline(file, stopWord, '\n')) {
      this->stopWords.push_back(stopWord);
    }
  }

  /* Article extractor methods */
  void *Indexer::extractArticles(void *ptr) {
    pthread_setcanceltype(PTHREAD_CANCEL_DEFERRED, NULL);
    kiwix::Indexer *self = (kiwix::Indexer *)ptr;

    /* Get the number of article to index and the ZIM id */
    kiwix::Reader reader(self->getZimPath());
    unsigned int articleCount = reader.getGlobalCount();
    self->setArticleCount(articleCount);
    string zimId = reader.getId();
    self->setZimId(zimId);

    /* Progression */
    unsigned int readArticleCount = 0;
    unsigned int currentProgression = 0;
    self->setProgression(currentProgression);
    unsigned int tmpProgression;

    /* StopWords */
    self->readStopWords(reader.getLanguage());

    /* Goes trough all articles */
    zim::File *zimHandler = reader.getZimFileHandler();
    unsigned int currentOffset = zimHandler->getNamespaceBeginOffset('A');
    unsigned int lastOffset = zimHandler->getNamespaceEndOffset('A');
    zim::Article currentArticle;

    while (currentOffset < lastOffset) {
      currentArticle = zimHandler->getArticle(currentOffset);
      
      if (!currentArticle.isRedirect()) {
	/* Add articles to the queue */
	indexerToken token;
	token.title = currentArticle.getTitle();
	token.url = currentArticle.getLongUrl();
	token.content = string(currentArticle.getData().data(), currentArticle.getData().size());
	self->pushToParseQueue(token);
      }

      readArticleCount += 1;
      currentOffset += 1;

      /* Update the progression counter (in percent) */
      tmpProgression = (unsigned int)((float)readArticleCount/(float)articleCount*100 - 1);
      if (tmpProgression > currentProgression) {
	currentProgression = tmpProgression;
	self->setProgression(currentProgression);
      }

      /* Test if the thread should be cancelled */
      pthread_testcancel();
    } 

    self->articleExtractorRunning(false);
    pthread_exit(NULL);
    return NULL;
  }
  
  void Indexer::articleExtractorRunning(bool value) {
    pthread_mutex_lock(&articleExtractorRunningMutex);
    this->articleExtractorRunningFlag = value;
    pthread_mutex_unlock(&articleExtractorRunningMutex); 
  }
  
  bool Indexer::isArticleExtractorRunning() {
    pthread_mutex_lock(&articleExtractorRunningMutex);
    bool retVal = this->articleExtractorRunningFlag;
    pthread_mutex_unlock(&articleExtractorRunningMutex); 
    return retVal;
  }
  
  /* Article parser methods */
  void *Indexer::parseArticles(void *ptr) {
    pthread_setcanceltype(PTHREAD_CANCEL_DEFERRED, NULL);
    kiwix::Indexer *self = (kiwix::Indexer *)ptr;
    size_t found;
    indexerToken token;

    while (self->popFromToParseQueue(token)) {
      MyHtmlParser htmlParser;

      /* The parser generate a lot of exceptions which should be avoided */
      try {
	htmlParser.parse_html(token.content, "UTF-8", true);
      } catch (...) {
      }

      /* If content does not have the noindex meta tag */
      /* Seems that the parser generates an exception in such case */
      found = htmlParser.dump.find("NOINDEX");
      
      if (found == string::npos) {
	/* Get the accented title */
	token.accentedTitle = (htmlParser.title.empty() ? token.title : htmlParser.title);

	/* count words */
	stringstream countWordStringStream;
	countWordStringStream << self->countWords(htmlParser.dump);
	token.wordCount = countWordStringStream.str();
	
	/* snippet */
	std::string snippet = std::string(htmlParser.dump, 0, 300);
	std::string::size_type last = snippet.find_last_of('.');
	if (last == snippet.npos)
	  last = snippet.find_last_of(' ');
	if (last != snippet.npos)
	  snippet = snippet.substr(0, last);
	token.snippet = snippet;

	/* size */
	stringstream sizeStringStream;
	sizeStringStream << token.content.size() / 1024;
	token.size = sizeStringStream.str();

	/* Remove accent */
	token.title = kiwix::removeAccents(token.accentedTitle);
	token.keywords = kiwix::removeAccents(htmlParser.keywords);
	token.content = kiwix::removeAccents(htmlParser.dump);
	self->pushToIndexQueue(token);
      }

      /* Test if the thread should be cancelled */
      pthread_testcancel(); 
    }
    
    self->articleParserRunning(false);
    pthread_exit(NULL);
    return NULL;
  }

  void Indexer::articleParserRunning(bool value) {
    pthread_mutex_lock(&articleParserRunningMutex);
    this->articleParserRunningFlag = value;
    pthread_mutex_unlock(&articleParserRunningMutex); 
  }
  
  bool Indexer::isArticleParserRunning() {
    pthread_mutex_lock(&articleParserRunningMutex);
    bool retVal = this->articleParserRunningFlag;
    pthread_mutex_unlock(&articleParserRunningMutex); 
    return retVal;
  }

  /* Article indexer methods */
  void *Indexer::indexArticles(void *ptr) {
    pthread_setcanceltype(PTHREAD_CANCEL_DEFERRED, NULL);
    kiwix::Indexer *self = (kiwix::Indexer *)ptr;
    unsigned int indexedArticleCount = 0;
    indexerToken token;

    self->indexingPrelude(self->getIndexPath()); 

    while (self->popFromToIndexQueue(token)) {
      self->index(token.url, 
		  token.accentedTitle,
		  token.title, 
		  token.keywords,
		  token.content,
		  token.snippet,
		  token.size,
		  token.wordCount
		  );

      indexedArticleCount += 1;

      /* Make a hard-disk flush every 10.000 articles */
      if (indexedArticleCount % 5000 == 0) {
	self->flush();
      }

      /* Test if the thread should be cancelled */
      pthread_testcancel();
    }
    self->indexingPostlude(self->getIndexPath());

    /* Write content id file */
    string path = appendToDirectory(self->getIndexPath(), "content.id");
    writeTextFile(path, self->getZimId());

    self->setProgression(100);
    kiwix::sleep(100);

    self->articleIndexerRunning(false);
    pthread_exit(NULL);
    return NULL;
  }

  void Indexer::articleIndexerRunning(bool value) {
    pthread_mutex_lock(&articleIndexerRunningMutex);
    this->articleIndexerRunningFlag = value;
    pthread_mutex_unlock(&articleIndexerRunningMutex); 
  }
  
  bool Indexer::isArticleIndexerRunning() {
    pthread_mutex_lock(&articleIndexerRunningMutex);
    bool retVal = this->articleIndexerRunningFlag;
    pthread_mutex_unlock(&articleIndexerRunningMutex); 
    return retVal;
  }

  /* ToParseQueue methods */
  bool Indexer::isToParseQueueEmpty() {
    pthread_mutex_lock(&toParseQueueMutex);
    bool retVal = this->toParseQueue.empty();
    pthread_mutex_unlock(&toParseQueueMutex);
    return retVal;
  }

  void Indexer::pushToParseQueue(indexerToken &token) {
    pthread_mutex_lock(&toParseQueueMutex); 
    this->toParseQueue.push(token);
    pthread_mutex_unlock(&toParseQueueMutex); 
    kiwix::sleep(int(this->toParseQueue.size() / 200) / 10 * 1000);
  }

  bool Indexer::popFromToParseQueue(indexerToken &token) {
    while (this->isToParseQueueEmpty() && this->isArticleExtractorRunning()) {
      kiwix::sleep(500);
      if (this->getVerboseFlag()) {
	std::cout << "Waiting... ToParseQueue is empty for now..." << std::endl;
      }

      pthread_testcancel();
    }

    if (!this->isToParseQueueEmpty()) {
      pthread_mutex_lock(&toParseQueueMutex); 
      token = this->toParseQueue.front();
      this->toParseQueue.pop();
      pthread_mutex_unlock(&toParseQueueMutex); 
    } else {
      return false;
    }

    return true;
  }

  /* ToIndexQueue methods */
  bool Indexer::isToIndexQueueEmpty() {
    pthread_mutex_lock(&toIndexQueueMutex);
    bool retVal = this->toIndexQueue.empty();
    pthread_mutex_unlock(&toIndexQueueMutex);
    return retVal;
  }

  void Indexer::pushToIndexQueue(indexerToken &token) {
    pthread_mutex_lock(&toIndexQueueMutex); 
    this->toIndexQueue.push(token);
    pthread_mutex_unlock(&toIndexQueueMutex);
    kiwix::sleep(int(this->toIndexQueue.size() / 200) / 10 * 1000);
  }

  bool Indexer::popFromToIndexQueue(indexerToken &token) {
    while (this->isToIndexQueueEmpty() && this->isArticleParserRunning()) {
      kiwix::sleep(500);
      if (this->getVerboseFlag()) {
	std::cout << "Waiting... ToIndexQueue is empty for now..." << std::endl;
      }

      pthread_testcancel();
    }

    if (!this->isToIndexQueueEmpty()) {
      pthread_mutex_lock(&toIndexQueueMutex); 
      token = this->toIndexQueue.front();
      this->toIndexQueue.pop();
      pthread_mutex_unlock(&toIndexQueueMutex); 
    } else {
      return false;
    }

    return true;
  }

  /* ZIM & Index methods */
  void Indexer::setZimPath(const string path) {
    pthread_mutex_lock(&zimPathMutex);
    this->zimPath = path;
    pthread_mutex_unlock(&zimPathMutex); 
  }

  string Indexer::getZimPath() {
    pthread_mutex_lock(&zimPathMutex); 
    string retVal = this->zimPath;
    pthread_mutex_unlock(&zimPathMutex);
    return retVal;
  }

  void Indexer::setIndexPath(const string path) {
    pthread_mutex_lock(&indexPathMutex); 
    this->indexPath = path;
    pthread_mutex_unlock(&indexPathMutex); 
  }

  string Indexer::getIndexPath() {
    pthread_mutex_lock(&indexPathMutex); 
    string retVal = this->indexPath;
    pthread_mutex_unlock(&indexPathMutex);
    return retVal;
  }

  void Indexer::setArticleCount(const unsigned int articleCount) {
    pthread_mutex_lock(&articleCountMutex);
    this->articleCount = articleCount;
    pthread_mutex_unlock(&articleCountMutex); 
  }

  unsigned int Indexer::getArticleCount() {
    pthread_mutex_lock(&articleCountMutex);
    unsigned int retVal = this->articleCount;
    pthread_mutex_unlock(&articleCountMutex);
    return retVal;
  }

  void Indexer::setProgression(const unsigned int progression) {
    pthread_mutex_lock(&progressionMutex); 
    this->progression = progression;
    pthread_mutex_unlock(&progressionMutex); 
  }

  unsigned int Indexer::getProgression() {
    pthread_mutex_lock(&progressionMutex); 
    unsigned int retVal = this->progression;
    pthread_mutex_unlock(&progressionMutex); 
    return retVal;
  }

  void Indexer::setZimId(const string id) {
    pthread_mutex_lock(&zimIdMutex);
    this->zimId = id;
    pthread_mutex_unlock(&zimIdMutex); 
  }

  string Indexer::getZimId() {
    pthread_mutex_lock(&zimIdMutex); 
    string retVal = this->zimId;
    pthread_mutex_unlock(&zimIdMutex);
    return retVal;
  }

  /* Manage */
  bool Indexer::start(const string zimPath, const string indexPath) {
    if (this->getVerboseFlag()) {
      std::cout << "Indexing of '" << zimPath << "' starting..." <<std::endl;
    }

    this->setArticleCount(0);
    this->setProgression(0);
    this->setZimPath(zimPath);
    this->setIndexPath(indexPath);

    pthread_mutex_lock(&threadIdsMutex); 
    this->articleExtractorRunning(true);
    pthread_create(&(this->articleExtractor), NULL, Indexer::extractArticles, (void*)this);
    pthread_detach(this->articleExtractor);

    while(this->isArticleExtractorRunning() && this->getArticleCount() == 0) {
      kiwix::sleep(100);
    }
    
    this->articleParserRunning(true);
    pthread_create(&(this->articleParser), NULL, Indexer::parseArticles, (void*)this);
    pthread_detach(this->articleParser);

    this->articleIndexerRunning(true);
    pthread_create(&(this->articleIndexer), NULL, Indexer::indexArticles, (void*)this);
    pthread_detach(this->articleIndexer);
    pthread_mutex_unlock(&threadIdsMutex);

    return true;
  }

  bool Indexer::isRunning() {
      if (this->getVerboseFlag()) {
	std::cout << "isArticleExtractor running: " << (this->isArticleExtractorRunning() ? "yes" : "no") << std::endl;
	std::cout << "isArticleParser running: " << (this->isArticleParserRunning() ? "yes" : "no") << std::endl;
	std::cout << "isArticleIndexer running: " << (this->isArticleIndexerRunning() ? "yes" : "no") << std::endl;
      }

    return this->isArticleExtractorRunning() || this->isArticleIndexerRunning() || this->isArticleParserRunning();
  }

  bool Indexer::stop() {
    if (this->isRunning()) {
      bool isArticleExtractorRunning = this->isArticleExtractorRunning();
      bool isArticleIndexerRunning = this->isArticleIndexerRunning();
      bool isArticleParserRunning = this->isArticleParserRunning();
      
      pthread_mutex_lock(&threadIdsMutex); 
      
      if (isArticleIndexerRunning) {
	pthread_cancel(this->articleIndexer);
	this->articleIndexerRunning(false);
      }
      if (isArticleParserRunning) {
	pthread_cancel(this->articleParser);
	this->articleParserRunning(false);
      }
      if (isArticleExtractorRunning) {
	pthread_cancel(this->articleExtractor);
	this->articleExtractorRunning(false);
      }

      pthread_mutex_unlock(&threadIdsMutex); 
    }

    return true;
  }

  /* Manage the verboseFlag */
  void Indexer::setVerboseFlag(const bool value) {
    pthread_mutex_lock(&verboseMutex);
    this->verboseFlag = value;
    pthread_mutex_unlock(&verboseMutex);
  }

  bool Indexer::getVerboseFlag() {
    bool value;
    pthread_mutex_lock(&verboseMutex);
    value = this->verboseFlag;
    pthread_mutex_unlock(&verboseMutex);
    return value;
  }

}
