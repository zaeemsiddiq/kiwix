/*
 * Copyright 2014 Emmanuel Engelhart <kelson@kiwix.org>
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

#ifndef KIWIX_INDEXER_H
#define KIWIX_INDEXER_H

#include <string>
#include <vector>
#include <stack>
#include <queue>
#include <fstream>
#include <iostream>
#include <sstream>

#include <pthread.h>
#include <stringTools.h>
#include <otherTools.h>
#include <resourceTools.h>
#include <zim/file.h>
#include <zim/article.h>
#include <zim/fileiterator.h>
#include "reader.h"
#include "xapian/myhtmlparse.h"

using namespace std;

namespace kiwix {

  struct indexerToken {
    string url;
    string accentedTitle;
    string title;
    string keywords;
    string content;
    string snippet;
    string size;
    string wordCount;
  };
  
  class Indexer {
    
  public:
    Indexer();
    virtual ~Indexer();

    bool start(const string zimPath, const string indexPath);
    bool stop();
    bool isRunning();
    unsigned int getProgression();
    void setVerboseFlag(const bool value);

  protected:
    virtual void indexingPrelude(const string indexPath) = 0;
    virtual void index(const string &url, 
		       const string &title, 
		       const string &unaccentedTitle,
		       const string &keywords, 
		       const string &content,
		       const string &snippet,
		       const string &size,
		       const string &wordCount) = 0;
    virtual void flush() = 0;
    virtual void indexingPostlude(const string indexPath) = 0;

    /* Stop words */
    std::vector<std::string> stopWords;
    void readStopWords(const string languageCode);

    /* Others */
    unsigned int countWords(const string &text);

    /* Boost factor */
    unsigned int keywordsBoostFactor;
    inline unsigned int getTitleBoostFactor(const unsigned int contentLength) {
      return contentLength / 500 + 1;
    }

    /* Verbose */
    pthread_mutex_t verboseMutex;
    bool getVerboseFlag();
    bool verboseFlag;

  private:
    pthread_mutex_t threadIdsMutex;

    /* Article extraction */
    pthread_t articleExtractor;
    pthread_mutex_t articleExtractorRunningMutex;
    static void *extractArticles(void *ptr);
    bool articleExtractorRunningFlag;
    bool isArticleExtractorRunning();
    void articleExtractorRunning(bool value);

    /* Article parsing */
    pthread_t articleParser;
    pthread_mutex_t articleParserRunningMutex;
    static void *parseArticles(void *ptr);
    bool articleParserRunningFlag;
    bool isArticleParserRunning();
    void articleParserRunning(bool value);

    /* Index writting */
    pthread_t articleIndexer;
    pthread_mutex_t articleIndexerRunningMutex;
    static void *indexArticles(void *ptr);
    bool articleIndexerRunningFlag;
    bool isArticleIndexerRunning();
    void articleIndexerRunning(bool value);

    /* To parse queue */
    std::queue<indexerToken> toParseQueue;
    pthread_mutex_t toParseQueueMutex;
    void pushToParseQueue(indexerToken &token);
    bool popFromToParseQueue(indexerToken &token);
    bool isToParseQueueEmpty();

    /* To index queue */
    std::queue<indexerToken> toIndexQueue;
    pthread_mutex_t toIndexQueueMutex;
    void pushToIndexQueue(indexerToken &token);
    bool popFromToIndexQueue(indexerToken &token);
    bool isToIndexQueueEmpty();

    /* Article Count & Progression */
    unsigned int articleCount;
    pthread_mutex_t articleCountMutex;
    void setArticleCount(const unsigned int articleCount);
    unsigned int getArticleCount();

    /* Progression */
    unsigned int progression;
    pthread_mutex_t progressionMutex;
    void setProgression(const unsigned int progression);
    /* getProgression() is public */

    /* ZIM path */
    pthread_mutex_t zimPathMutex;
    string zimPath;
    void setZimPath(const string path);
    string getZimPath();

    /* Index path */
    pthread_mutex_t indexPathMutex;
    string indexPath;
    void setIndexPath(const string path);
    string getIndexPath();

    /* ZIM id */
    pthread_mutex_t zimIdMutex;
    string zimId;
    void setZimId(const string id);
    string getZimId();
  };
}

#endif
