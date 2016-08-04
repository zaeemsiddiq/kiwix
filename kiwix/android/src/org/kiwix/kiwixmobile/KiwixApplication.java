package org.kiwix.kiwixmobile;

import android.app.Application;
import android.widget.Toast;

import okhttp3.OkHttpClient;
import org.kiwix.kiwixmobile.network.KiwixService;
import retrofit2.Retrofit;
import retrofit2.adapter.rxjava.RxJavaCallAdapterFactory;
import retrofit2.converter.simplexml.SimpleXmlConverterFactory;
import rx.schedulers.Schedulers;

public class KiwixApplication extends Application {

  private static KiwixService service;
  private static OkHttpClient client = new OkHttpClient();

  @Override public void onCreate() {
    super.onCreate();
    createRetrofitService();
  }

  private void createRetrofitService() {
    Retrofit retrofit = new Retrofit.Builder()
        .baseUrl("http://kiwix.org/")
        .addConverterFactory(SimpleXmlConverterFactory.create())
        .addCallAdapterFactory(RxJavaCallAdapterFactory.createWithScheduler(Schedulers.io()))
        .build();

    service = retrofit.create(KiwixService.class);
  }

  public KiwixService getKiwixService() {
    return service;
  }

  public OkHttpClient getOkHttpClient() {
    return client;
  }
}
